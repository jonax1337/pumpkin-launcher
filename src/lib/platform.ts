/** Betriebssystem der Oberfläche, am User-Agent der WebView erkannt (WebView2, WKWebView, WebKitGTK; ebenso im Browser). */
export const platform: "windows" | "macos" | "linux" = /Windows/.test(navigator.userAgent)
  ? "windows"
  : /Macintosh/.test(navigator.userAgent)
    ? "macos"
    : "linux";
