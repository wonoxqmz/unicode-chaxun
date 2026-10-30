package com.unchaxun.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * 就一个 WebView 装 index.html，没有别的。
 *
 * 几个必须开的东西：
 *   setDomStorageEnabled  —— 收藏、自定义字义全存在 localStorage，不开就是一次性的
 *   setAllowFileAccess    —— 页面在 assets 里，用 file:///android_asset 读
 *   INTERNET 权限         —— 同步的取件码要访问 https://unchaxun.pages.dev
 *
 * 外部链接：页面跑在 file:// 上，任何 http(s)/mailto 链接都算外部内容，
 * 一律交给系统浏览器打开（裸 WebView 里 target="_blank" 默认点了没反应，
 * 而在应用内直接导航会把整个应用页面顶掉，都不能要）。
 *
 * 返回键：能后退就后退，到底了再按一次才退出（防手滑）。
 */
public class MainActivity extends Activity {

    private WebView web;
    private long lastBackAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#f8f9fa"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        // v0.2.2：页面要读打进 assets 的离线数据包（file:///android_asset/unicode_data/*）。
        // file:// 页面默认禁止 XHR 读 file 资源，这里显式放开——页面是我们自己的资产，没有第三方内容
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                boolean external = url.startsWith("http://") || url.startsWith("https://")
                        || url.startsWith("mailto:");
                if (!external) return false;   // file:// 等自有页面照常在应用内加载
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    Toast.makeText(MainActivity.this, "正在用浏览器打开链接",
                            Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "没有能打开这个链接的应用",
                            Toast.LENGTH_SHORT).show();
                }
                return true;   // 链接已接管，别让 WebView 自己加载
            }
        });
        web.setWebChromeClient(new WebChromeClient());

        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackAt < 2000) {
            super.onBackPressed();
        } else {
            lastBackAt = now;
            Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
