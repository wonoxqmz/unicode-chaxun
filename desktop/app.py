# -*- coding: utf-8 -*-
"""
Unicode 编码查询 - 桌面版启动器

做的事只有三件：
  1. 在 127.0.0.1 上起一个只读的小 HTTP 服务，把 index.html 喂给 WebView2
     （用 http 而不是 file://，这样 localStorage 的 origin 是固定的，收藏才存得住）
  2. 开一个 pywebview 窗口（WebView2 内核，Win10/11 自带，不用打包浏览器）
  3. 窗口关掉就退出，顺手把服务停掉

打包：pyinstaller --onefile --noconsole --add-data "index.html;." app.py
"""

import os
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---- 启动计时（排查「双击后半天没反应」用；只在设置了 UNICODE_DEBUG_LOG 时才写） ----
_T0 = time.time()
_LOG = os.environ.get("UNICODE_DEBUG_LOG")


def _mark(msg):
    if not _LOG:
        return
    try:
        with open(_LOG, "a", encoding="utf-8") as fh:
            fh.write("%7.2fs  %s\n" % (time.time() - _T0, msg))
    except OSError:
        pass


_mark("app.py 开始执行")

APP_TITLE = "Unicode 编码查询"
BASE_PORT = 8731
PORT_TRIES = 10
SERVER_TAG = "unicode-chaxun-desktop"


def resource_dir():
    """PyInstaller onefile 会把资源解到临时目录 _MEIPASS；源码直跑时就是本文件目录。"""
    if getattr(sys, "_MEIPASS", None):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def data_dir():
    """收藏、字义这些存在 WebView2 的用户数据目录里，放 LOCALAPPDATA 才不会丢。"""
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    path = os.path.join(base, "UnicodeChaxun")
    os.makedirs(path, exist_ok=True)
    return path


class Handler(BaseHTTPRequestHandler):
    root = resource_dir()

    def do_GET(self):
        _mark("收到页面请求: %s" % self.path)
        name = "index.html" if self.path in ("", "/", "/index.html") else self.path.lstrip("/").split("?")[0]
        # 只放行打包进来的文件，别把磁盘上任意路径暴露出去
        target = os.path.normpath(os.path.join(self.root, name))
        # 必须比到分隔符：`_MEI123` 是 `_MEI1234` 的前缀，只做 startswith 会放行同前缀的兄弟目录
        root = os.path.normpath(self.root)
        if not (target == root or target.startswith(root + os.sep)) or not os.path.isfile(target):
            self.send_error(404)
            return
        with open(target, "rb") as fh:
            body = fh.read()
        ctype = "text/html; charset=utf-8" if target.endswith(".html") else "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-App", SERVER_TAG)
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("X-App", SERVER_TAG)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass  # 别往控制台刷日志


def port_free(port):
    """Windows 下 SO_REUSEADDR 会让两个进程绑同一个端口，所以这里不设它。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


class Server(ThreadingHTTPServer):
    # 默认的 allow_reuse_address=True 在 Windows 上允许多个进程绑同一端口，
    # 结果新连接可能被分到已经退出的旧进程上，表现就是「端口在监听但连不上」
    allow_reuse_address = False
    daemon_threads = True


def find_existing():
    """已经有一个实例在跑？直接连它。

    否则第二次双击会占用 8732，浏览器把 8731 和 8732 当成两个不同站点，
    收藏、字义看起来就全没了 —— 这是最容易让人以为"数据丢了"的坑。
    """
    for offset in range(PORT_TRIES):
        port = BASE_PORT + offset
        if port_free(port):
            return None
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1.0) as s:
                s.sendall(b"HEAD / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                head = s.recv(1024).decode("latin-1", "ignore")
            if SERVER_TAG in head:
                return port
        except OSError:
            continue
    return None


def start_server():
    for offset in range(PORT_TRIES):
        port = BASE_PORT + offset
        try:
            srv = Server(("127.0.0.1", port), Handler)
        except OSError:
            continue
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv, port
    raise RuntimeError("8731-8740 全部被占用，无法启动本地服务")


def main():
    if not os.path.isfile(os.path.join(resource_dir(), "index.html")):
        # 最典型的翻车：打包时忘了 --add-data
        raise SystemExit("index.html 没打包进来，请检查 --add-data \"index.html;.\"")

    _mark("开始找端口")
    existing = find_existing()
    if existing:
        srv, port = None, existing
    else:
        srv, port = start_server()
    _mark("本地服务已就绪 http://127.0.0.1:%d/" % port)

    # 放到这里才导入：pywebview 会拉起 .NET（pythonnet），在旧机器上要好几秒。
    # 先让本地服务起来，急的话浏览器直接打开这个地址也能用。
    _mark("开始导入 pywebview")
    import webview
    _mark("pywebview 导入完成")

    webview.create_window(
        APP_TITLE,
        "http://127.0.0.1:%d/" % port,
        width=1280,
        height=860,
        min_size=(880, 600),
        text_select=True,
    )
    _mark("窗口对象已创建")
    try:
        # private_mode=False 是关键：否则每次启动都是全新的浏览器空间，收藏白攒
        webview.start(
            func=lambda: _mark("窗口已显示"),
            private_mode=False,
            storage_path=data_dir(),
            debug=False,
        )
        _mark("窗口已关闭")
    finally:
        if srv is not None:
            srv.shutdown()


if __name__ == "__main__":
    main()
