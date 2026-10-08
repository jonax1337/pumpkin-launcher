// Native NSIS Unicode/x86 plugin. Build with build.ps1 and the NSIS plugin SDK.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <richedit.h>
#include <dwmapi.h>
#include <uxtheme.h>
#include <pluginapi.h>
#include <algorithm>
#include <cstddef>
#include <iterator>
#include <memory>
#include <new>
#include <vector>

static_assert(sizeof(void*) == 4, "NSIS requires the x86 plugin build");
static_assert(sizeof(wchar_t) == 2 && sizeof(TCHAR) == 2, "NSIS Unicode ABI required");
static_assert(sizeof(extra_parameters) == 16);
static_assert(offsetof(extra_parameters, RegisterPluginCallback) == 12);
static_assert(offsetof(exec_flags_t, plugin_api_version) == 28);

namespace {
constexpr UINT_PTR subclass_id = 1;
constexpr COLORREF background = RGB(16, 21, 33);
constexpr COLORREF surface = RGB(32, 40, 56);
constexpr COLORREF foreground = RGB(244, 238, 230);
constexpr COLORREF muted = RGB(160, 168, 184);
constexpr COLORREF accent = RGB(227, 152, 96);
constexpr COLORREF pressed = RGB(197, 120, 67);
constexpr COLORREF border = RGB(80, 92, 112);

enum class Kind { other, dialog, button, edit, listbox, listview, progress, separator };
struct Window {
    HWND handle;
    Kind kind;
    LONG_PTR original_style;
    LONG_PTR original_extended_style;
    bool owner_draw;
    bool default_button;
    bool heading{};
    HFONT original_font{};
    HFONT themed_font{};
    ~Window() { if (themed_font) DeleteObject(themed_font); }
};

// NSIS invokes the plugin and its HWND callbacks on the installer UI thread.
HMODULE module{};
HWND root{};
bool registered{};
bool high_contrast{};
std::vector<std::unique_ptr<Window>> windows;
HANDLE private_fonts[3]{};

struct Artwork {
    HBITMAP bitmap{};
    HDC dc{};
    HGDIOBJ previous{};
    BITMAP dimensions{};

    void load(const wchar_t* path) noexcept {
        bitmap = static_cast<HBITMAP>(LoadImageW(nullptr, path, IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE));
        if (!bitmap) return;
        dc = CreateCompatibleDC(nullptr);
        if (!dc) { DeleteObject(bitmap); bitmap = nullptr; return; }
        previous = SelectObject(dc, bitmap);
        if (!GetObjectW(bitmap, sizeof(dimensions), &dimensions)
            || dimensions.bmWidth <= 0 || dimensions.bmHeight <= 0) release();
    }

    void release() noexcept {
        if (dc) { SelectObject(dc, previous); DeleteDC(dc); dc = nullptr; }
        if (bitmap) { DeleteObject(bitmap); bitmap = nullptr; }
    }
};
Artwork sidebar_art;
Artwork header_art;

LRESULT CALLBACK window_proc(HWND, UINT, WPARAM, LPARAM, UINT_PTR, DWORD_PTR);
UINT_PTR __cdecl plugin_callback(NSPIM message) noexcept;

bool is_high_contrast() noexcept {
    HIGHCONTRASTW settings{sizeof(settings)};
    return !SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(settings), &settings, 0)
        || (settings.dwFlags & HCF_HIGHCONTRASTON) != 0;
}

COLORREF page_color() noexcept { return high_contrast ? GetSysColor(COLOR_BTNFACE) : background; }
COLORREF input_color() noexcept { return high_contrast ? GetSysColor(COLOR_WINDOW) : surface; }
COLORREF text_color() noexcept { return high_contrast ? GetSysColor(COLOR_BTNTEXT) : foreground; }
COLORREF disabled_color() noexcept { return high_contrast ? GetSysColor(COLOR_GRAYTEXT) : muted; }
COLORREF edge_color() noexcept { return high_contrast ? GetSysColor(COLOR_WINDOWTEXT) : border; }

HBRUSH color_brush(HDC dc, COLORREF color) noexcept {
    SetDCBrushColor(dc, color);
    return static_cast<HBRUSH>(GetStockObject(DC_BRUSH));
}

void fill(HDC dc, const RECT& rectangle, COLORREF color) noexcept {
    FillRect(dc, &rectangle, color_brush(dc, color));
}

int scaled(HWND handle, HDC dc, int pixels) noexcept {
    using WindowDpi = UINT(WINAPI*)(HWND);
    static const auto window_dpi = reinterpret_cast<WindowDpi>(
        GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetDpiForWindow"));
    const UINT dpi = window_dpi ? window_dpi(handle) : 0;
    return MulDiv(pixels, dpi ? static_cast<int>(dpi) : GetDeviceCaps(dc, LOGPIXELSX), 96);
}

bool register_plugin(extra_parameters* extra) noexcept {
    if (!extra || !extra->exec_flags || extra->exec_flags->plugin_api_version < NSISPIAPIVER_1_0)
        return false;
    if (!registered) {
        if (!extra->RegisterPluginCallback
            || extra->RegisterPluginCallback(module, plugin_callback) < 0) return false;
        registered = true;
    }
    return true;
}

void load_fonts() noexcept {
    for (int index = 0; index < 3; ++index) {
        if (private_fonts[index]) continue;
        const auto resource = FindResourceW(module, MAKEINTRESOURCEW(101 + index), RT_RCDATA);
        if (!resource) continue;
        const auto loaded = LoadResource(module, resource);
        const auto bytes = LockResource(loaded);
        DWORD count{};
        if (bytes) private_fonts[index] = AddFontMemResourceEx(
            bytes, SizeofResource(module, resource), nullptr, &count);
    }
}

HFONT themed_font(Window& window, HFONT source) noexcept {
    if (source == window.themed_font && source) return source;
    LOGFONTW font{};
    if (!source || !GetObjectW(source, sizeof(font), &font)) return source;
    wchar_t class_name[32]{};
    GetClassNameW(window.handle, class_name, static_cast<int>(std::size(class_name)));
    // MUI title controls: 1201 welcome/finish title, 1037 page header title. Big Shoulders is narrow,
    // so it is enlarged relative to the NSIS font (already DPI-scaled) to keep the heading dominant.
    // nsDialogs numbers custom-page controls from 1200, so 1201 only counts when MUI made it bold.
    const int id = GetDlgCtrlID(window.handle);
    const bool is_static = lstrcmpiW(class_name, L"Static") == 0;
    const bool welcome_title = id == 1201 && font.lfWeight >= FW_BOLD;
    const bool heading = is_static && (welcome_title || id == 1037);
    window.heading = heading;
    if (heading) font.lfHeight = MulDiv(font.lfHeight, id == 1201 ? 2 : 3, id == 1201 ? 1 : 2);
    lstrcpynW(font.lfFaceName, heading ? L"Big Shoulders Display" : L"Hanken Grotesk", LF_FACESIZE);
    const auto replacement = CreateFontIndirectW(&font);
    if (!replacement) return source;
    const auto previous = window.themed_font;
    window.original_font = source;
    window.themed_font = replacement;
    // Send the replacement before releasing a font that a control may still be using.
    SendMessageW(window.handle, WM_SETFONT, reinterpret_cast<WPARAM>(replacement), FALSE);
    if (previous) DeleteObject(previous);
    return replacement;
}

void uppercase_heading(HWND handle, const wchar_t* text) noexcept {
    wchar_t caption[1024]{};
    lstrcpynW(caption, text ? text : L"", static_cast<int>(std::size(caption)));
    CharUpperBuffW(caption, lstrlenW(caption));
    SetWindowTextW(handle, caption);
}

Window* window_state(HWND handle) noexcept {
    DWORD_PTR data{};
    return GetWindowSubclass(handle, window_proc, subclass_id, &data)
        ? reinterpret_cast<Window*>(data) : nullptr;
}

Kind control_kind(HWND handle) noexcept {
    wchar_t name[64]{};
    GetClassNameW(handle, name, static_cast<int>(std::size(name)));
    if (lstrcmpiW(name, L"#32770") == 0) return Kind::dialog;
    if (lstrcmpiW(name, L"Button") == 0) return Kind::button;
    if (lstrcmpiW(name, L"Edit") == 0 || lstrcmpiW(name, L"RichEdit20W") == 0
        || lstrcmpiW(name, L"RichEdit20A") == 0 || lstrcmpiW(name, L"RichEdit") == 0
        || lstrcmpiW(name, L"RICHEDIT50W") == 0) return Kind::edit;
    if (lstrcmpiW(name, L"ListBox") == 0) return Kind::listbox;
    if (lstrcmpiW(name, WC_LISTVIEWW) == 0) return Kind::listview;
    if (lstrcmpiW(name, PROGRESS_CLASSW) == 0) return Kind::progress;
    if (lstrcmpiW(name, L"Static") == 0
        && (GetWindowLongPtrW(handle, GWL_STYLE) & SS_TYPEMASK) == SS_ETCHEDHORZ)
        return Kind::separator;
    return Kind::other;
}

bool is_choice(const Window& window) noexcept {
    const auto type = window.original_style & BS_TYPEMASK;
    return window.kind == Kind::button && (type == BS_CHECKBOX || type == BS_AUTOCHECKBOX
        || type == BS_3STATE || type == BS_AUTO3STATE || type == BS_RADIOBUTTON
        || type == BS_AUTORADIOBUTTON);
}

void prepare_text(HDC dc, HWND handle) noexcept {
    const auto font = reinterpret_cast<HFONT>(SendMessageW(handle, WM_GETFONT, 0, 0));
    if (font) SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, IsWindowEnabled(handle) ? text_color() : disabled_color());
}

void draw_caption(HDC dc, HWND handle, RECT rectangle, UINT flags) noexcept {
    // NSIS navigation/option captions are bounded strings; no heap or GDI allocation during paint.
    wchar_t caption[1024]{};
    GetWindowTextW(handle, caption, static_cast<int>(std::size(caption)));
    if (SendMessageW(handle, WM_QUERYUISTATE, 0, 0) & UISF_HIDEACCEL) flags |= DT_HIDEPREFIX;
    if (GetWindowLongPtrW(handle, GWL_EXSTYLE) & WS_EX_RTLREADING) flags |= DT_RTLREADING;
    DrawTextW(dc, caption, -1, &rectangle, flags);
}

void draw_focus(HDC dc, HWND handle, RECT rectangle) noexcept {
    if (GetFocus() != handle || (SendMessageW(handle, WM_QUERYUISTATE, 0, 0) & UISF_HIDEFOCUS)) return;
    const int inset = scaled(handle, dc, 3);
    InflateRect(&rectangle, -inset, -inset);
    SetTextColor(dc, high_contrast ? GetSysColor(COLOR_WINDOWTEXT) : foreground);
    SetBkColor(dc, page_color());
    DrawFocusRect(dc, &rectangle);
}

void draw_pushbutton(const DRAWITEMSTRUCT& item, const Window& window) noexcept {
    const int saved = SaveDC(item.hDC);
    if (!saved) return;
    const bool disabled = (item.itemState & ODS_DISABLED) != 0;
    const bool primary = GetDlgCtrlID(item.hwndItem) == IDOK;
    const bool down = (item.itemState & ODS_SELECTED) != 0;
    const COLORREF face = high_contrast ? GetSysColor(COLOR_BTNFACE)
        : disabled ? surface : primary ? (down ? pressed : accent) : (down ? border : surface);
    fill(item.hDC, item.rcItem, face);
    FrameRect(item.hDC, &item.rcItem, color_brush(item.hDC,
        window.default_button && !disabled ? (high_contrast ? GetSysColor(COLOR_HIGHLIGHT) : accent) : edge_color()));
    prepare_text(item.hDC, item.hwndItem);
    if (!high_contrast && primary && !disabled) SetTextColor(item.hDC, background);
    RECT text = item.rcItem;
    if (down) {
        const int offset = scaled(item.hwndItem, item.hDC, 1);
        OffsetRect(&text, offset, offset);
    }
    draw_caption(item.hDC, item.hwndItem, text, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    if ((item.itemState & ODS_FOCUS) && !(item.itemState & ODS_NOFOCUSRECT)) {
        const int inset = scaled(item.hwndItem, item.hDC, 4);
        InflateRect(&text, -inset, -inset);
        SetBkColor(item.hDC, face);
        DrawFocusRect(item.hDC, &text);
    }
    RestoreDC(item.hDC, saved);
}

void draw_choice(HDC dc, const Window& window, RECT rectangle) noexcept {
    fill(dc, rectangle, page_color());
    prepare_text(dc, window.handle);
    const int size = scaled(window.handle, dc, 13);
    const int gap = scaled(window.handle, dc, 7);
    const bool right = (window.original_style & BS_LEFTTEXT) != 0;
    const int x = right ? rectangle.right - size : rectangle.left;
    const int y = rectangle.top + (rectangle.bottom - rectangle.top - size) / 2;
    RECT mark{x, y, x + size, y + size};
    const bool enabled = IsWindowEnabled(window.handle) != FALSE;
    const COLORREF ink = enabled ? (high_contrast ? GetSysColor(COLOR_WINDOWTEXT) : accent) : disabled_color();
    SelectObject(dc, GetStockObject(DC_PEN));
    SelectObject(dc, color_brush(dc, input_color()));
    SetDCPenColor(dc, ink);
    const auto type = window.original_style & BS_TYPEMASK;
    const bool radio = type == BS_RADIOBUTTON || type == BS_AUTORADIOBUTTON;
    if (radio) Ellipse(dc, mark.left, mark.top, mark.right, mark.bottom);
    else Rectangle(dc, mark.left, mark.top, mark.right, mark.bottom);
    const auto checked = SendMessageW(window.handle, BM_GETCHECK, 0, 0);
    if (checked != BST_UNCHECKED) {
        const int inset = scaled(window.handle, dc, 3);
        InflateRect(&mark, -inset, -inset);
        SelectObject(dc, color_brush(dc, ink));
        if (radio) Ellipse(dc, mark.left, mark.top, mark.right, mark.bottom);
        else if (checked == BST_INDETERMINATE) {
            mark.top = y + size / 2 - 1;
            mark.bottom = mark.top + scaled(window.handle, dc, 2);
            fill(dc, mark, ink);
        } else {
            const POINT points[]{{x + size / 5, y + size / 2},
                {x + size * 2 / 5, y + size * 4 / 5}, {x + size * 4 / 5, y + size / 5}};
            Polyline(dc, points, static_cast<int>(std::size(points)));
        }
    }
    RECT text = rectangle;
    if (right) text.right -= size + gap;
    else text.left += size + gap;
    const UINT flags = (window.original_style & BS_MULTILINE)
        ? DT_WORDBREAK : DT_VCENTER | DT_SINGLELINE;
    draw_caption(dc, window.handle, text, flags | (right ? DT_RIGHT : DT_LEFT));
    draw_focus(dc, window.handle, text);
}

void draw_group(HDC dc, const Window& window, RECT rectangle) noexcept {
    // Group contents are sibling HWNDs; filling this rectangle would cover their inputs/buttons.
    prepare_text(dc, window.handle);
    TEXTMETRICW metrics{};
    GetTextMetricsW(dc, &metrics);
    RECT frame = rectangle;
    frame.top += metrics.tmHeight / 2;
    FrameRect(dc, &frame, color_brush(dc, edge_color()));
    rectangle.left += scaled(window.handle, dc, 8);
    rectangle.bottom = rectangle.top + metrics.tmHeight;
    SetBkMode(dc, OPAQUE);
    SetBkColor(dc, page_color());
    draw_caption(dc, window.handle, rectangle, DT_LEFT | DT_SINGLELINE);
}

const Artwork* artwork_for(const Window& window) noexcept {
    if ((window.original_style & SS_TYPEMASK) != SS_BITMAP || window.kind != Kind::other) return nullptr;
    const int id = GetDlgCtrlID(window.handle);
    if (id != 1200 && id != 1046 && id != 1039) return nullptr;
    const auto& art = id == 1200 ? sidebar_art : header_art;
    return art.dc ? &art : nullptr;
}

void draw_artwork(HDC dc, const Artwork& art, const RECT& bounds) noexcept {
    fill(dc, bounds, page_color());
    const int width = bounds.right - bounds.left;
    const int height = bounds.bottom - bounds.top;
    int fitted_width = width;
    int fitted_height = MulDiv(width, art.dimensions.bmHeight, art.dimensions.bmWidth);
    if (fitted_height > height) {
        fitted_height = height;
        fitted_width = MulDiv(height, art.dimensions.bmWidth, art.dimensions.bmHeight);
    }
    SetStretchBltMode(dc, COLORONCOLOR);
    StretchBlt(dc, bounds.left + (width - fitted_width) / 2, bounds.top + (height - fitted_height) / 2,
        fitted_width, fitted_height, art.dc, 0, 0,
        art.dimensions.bmWidth, art.dimensions.bmHeight, SRCCOPY);
}

bool custom_paint(const Window& window) noexcept {
    return artwork_for(window) || is_choice(window)
        || (window.kind == Kind::button && (window.original_style & BS_TYPEMASK) == BS_GROUPBOX);
}

void paint_control(HDC dc, const Window& window) noexcept {
    const int saved = SaveDC(dc);
    if (!saved) return;
    RECT rectangle{};
    GetClientRect(window.handle, &rectangle);
    if (const auto* art = artwork_for(window)) draw_artwork(dc, *art, rectangle);
    else if (is_choice(window)) draw_choice(dc, window, rectangle);
    else draw_group(dc, window, rectangle);
    RestoreDC(dc, saved);
}

void apply_colors(Window& window) noexcept {
    const HWND handle = window.handle;
    const bool input = window.kind == Kind::edit || window.kind == Kind::listbox || window.kind == Kind::listview;
    if (input || window.kind == Kind::button || window.kind == Kind::progress)
        SetWindowTheme(handle, high_contrast ? nullptr : L"", high_contrast ? nullptr : L"");
    if (window.kind == Kind::separator) ShowWindow(handle, SW_HIDE);
    if (input || window.kind == Kind::progress) {
        const auto style = GetWindowLongPtrW(handle, GWL_STYLE);
        SetWindowLongPtrW(handle, GWL_STYLE,
            (style & ~WS_BORDER) | (high_contrast ? window.original_style & WS_BORDER : 0));
        const LONG_PTR edges = WS_EX_CLIENTEDGE | WS_EX_STATICEDGE;
        const auto extended = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        SetWindowLongPtrW(handle, GWL_EXSTYLE,
            (extended & ~edges) | (high_contrast ? window.original_extended_style & edges : 0));
        SetWindowPos(handle, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER
            | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
    if (window.kind == Kind::progress) {
        SendMessageW(handle, PBM_SETBKCOLOR, 0, input_color());
        SendMessageW(handle, PBM_SETBARCOLOR, 0, high_contrast ? GetSysColor(COLOR_HIGHLIGHT) : accent);
    } else if (window.kind == Kind::listview) {
        ListView_SetBkColor(handle, input_color());
        ListView_SetTextBkColor(handle, input_color());
        ListView_SetTextColor(handle, high_contrast ? GetSysColor(COLOR_WINDOWTEXT) : foreground);
    } else if (window.kind == Kind::edit) {
        // Rich-edit license controls do not use WM_CTLCOLOREDIT for their background.
        wchar_t name[64]{};
        GetClassNameW(handle, name, static_cast<int>(std::size(name)));
        if (lstrcmpiW(name, L"Edit") != 0) {
            SendMessageW(handle, EM_SETBKGNDCOLOR, 0, input_color());
            CHARFORMAT2W format{};
            format.cbSize = sizeof(format);
            format.dwMask = CFM_COLOR;
            format.crTextColor = high_contrast ? GetSysColor(COLOR_WINDOWTEXT) : foreground;
            SendMessageW(handle, EM_SETCHARFORMAT, SCF_ALL, reinterpret_cast<LPARAM>(&format));
        }
    }
}

void update_caption() noexcept {
    const BOOL dark = !high_contrast;
    // Documented Windows 11 attributes; older Windows may reject them without affecting installation.
    DwmSetWindowAttribute(root, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark));
    const COLORREF caption = high_contrast ? DWMWA_COLOR_DEFAULT : background;
    const COLORREF text = high_contrast ? DWMWA_COLOR_DEFAULT : foreground;
    DwmSetWindowAttribute(root, DWMWA_CAPTION_COLOR, &caption, sizeof(caption));
    DwmSetWindowAttribute(root, DWMWA_TEXT_COLOR, &text, sizeof(text));
}

LRESULT control_colors(HWND handle, UINT message, HDC dc) noexcept {
    const auto* state = window_state(handle);
    const bool input = message == WM_CTLCOLOREDIT || message == WM_CTLCOLORLISTBOX
        || (state && state->kind == Kind::edit);
    const COLORREF color = input ? input_color() : page_color();
    SetTextColor(dc, !IsWindowEnabled(handle) ? disabled_color()
        : high_contrast && input ? GetSysColor(COLOR_WINDOWTEXT) : text_color());
    SetBkColor(dc, color);
    return reinterpret_cast<LRESULT>(color_brush(dc, color));
}

void remove_window(Window* window) noexcept {
    RemoveWindowSubclass(window->handle, window_proc, subclass_id);
    const auto position = std::find_if(windows.begin(), windows.end(),
        [window](const auto& candidate) { return candidate.get() == window; });
    if (position != windows.end()) windows.erase(position);
}

LRESULT CALLBACK window_proc(HWND handle, UINT message, WPARAM wparam, LPARAM lparam,
    UINT_PTR, DWORD_PTR data) {
    auto& window = *reinterpret_cast<Window*>(data);
    if (message == WM_NCDESTROY) {
        remove_window(&window);
        if (handle == root) root = nullptr;
        return DefSubclassProc(handle, message, wparam, lparam);
    }
    if (message == WM_SETFONT)
        wparam = reinterpret_cast<WPARAM>(themed_font(window, reinterpret_cast<HFONT>(wparam)));
    if (message == WM_SETTEXT && window.heading) {
        wchar_t caption[1024]{};
        lstrcpynW(caption, lparam ? reinterpret_cast<const wchar_t*>(lparam) : L"",
            static_cast<int>(std::size(caption)));
        CharUpperBuffW(caption, lstrlenW(caption));
        return DefSubclassProc(handle, message, wparam, reinterpret_cast<LPARAM>(caption));
    }
    if (message >= WM_CTLCOLORMSGBOX && message <= WM_CTLCOLORSTATIC)
        return control_colors(reinterpret_cast<HWND>(lparam), message, reinterpret_cast<HDC>(wparam));
    if (message == WM_ERASEBKGND && window.kind == Kind::dialog) {
        RECT rectangle{};
        GetClientRect(handle, &rectangle);
        fill(reinterpret_cast<HDC>(wparam), rectangle, page_color());
        return 1;
    }
    if (message == WM_ERASEBKGND && custom_paint(window)) return 1;
    if (message == WM_DRAWITEM && lparam) {
        const auto& item = *reinterpret_cast<const DRAWITEMSTRUCT*>(lparam);
        const auto* button = window_state(item.hwndItem);
        if (item.CtlType == ODT_BUTTON && button && button->owner_draw) {
            draw_pushbutton(item, *button);
            return TRUE;
        }
    }
    if (window.owner_draw && message == BM_SETSTYLE) {
        const auto type = wparam & BS_TYPEMASK;
        if (type == BS_PUSHBUTTON || type == BS_DEFPUSHBUTTON) {
            window.default_button = type == BS_DEFPUSHBUTTON;
            return DefSubclassProc(handle, message, (wparam & ~BS_TYPEMASK) | BS_OWNERDRAW, lparam);
        }
    }
    if (window.owner_draw && message == WM_GETDLGCODE) {
        const auto code = DefSubclassProc(handle, message, wparam, lparam);
        return (code & ~(DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON)) | DLGC_BUTTON
            | (window.default_button ? DLGC_DEFPUSHBUTTON : DLGC_UNDEFPUSHBUTTON);
    }
    if (custom_paint(window) && message == WM_PAINT) {
        PAINTSTRUCT paint{};
        const HDC dc = BeginPaint(handle, &paint);
        if (dc) paint_control(dc, window);
        EndPaint(handle, &paint);
        return 0;
    }
    if (custom_paint(window) && message == WM_PRINTCLIENT) {
        paint_control(reinterpret_cast<HDC>(wparam), window);
        return 0;
    }
    if (handle == root && (message == WM_SETTINGCHANGE || message == WM_SYSCOLORCHANGE)) {
        high_contrast = is_high_contrast();
        for (const auto& child : windows) apply_colors(*child);
        update_caption();
        RedrawWindow(handle, nullptr, nullptr, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN);
    }
    const bool repaint = custom_paint(window) && (message == BM_SETCHECK || message == BM_SETSTATE
        || message == WM_ENABLE || message == WM_SETFOCUS || message == WM_KILLFOCUS
        || message == WM_UPDATEUISTATE || message == WM_SETTEXT);
    const bool dpi_changed = handle == root && message == WM_DPICHANGED;
    const auto result = DefSubclassProc(handle, message, wparam, lparam);
    // A native notification can destroy this HWND synchronously inside DefSubclassProc.
    if (repaint && window_state(handle) == reinterpret_cast<Window*>(data))
        InvalidateRect(handle, nullptr, FALSE);
    if (dpi_changed && IsWindow(handle))
        RedrawWindow(handle, nullptr, nullptr, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN);
    return result;
}

bool attach_window(HWND handle) {
    if (auto* existing = window_state(handle)) {
        // MUI shows its beveled dividers again on each page transition.
        if (existing->kind == Kind::separator) apply_colors(*existing);
        return true;
    }
    const auto kind = handle == root ? Kind::dialog : control_kind(handle);
    const auto style = GetWindowLongPtrW(handle, GWL_STYLE);
    const auto type = style & BS_TYPEMASK;
    const bool owner_draw = kind == Kind::button && (type == BS_PUSHBUTTON || type == BS_DEFPUSHBUTTON)
        && !(style & (BS_ICON | BS_BITMAP));
    auto state = std::make_unique<Window>();
    state->handle = handle;
    state->kind = kind;
    state->original_style = style;
    state->original_extended_style = GetWindowLongPtrW(handle, GWL_EXSTYLE);
    state->owner_draw = owner_draw;
    state->default_button = type == BS_DEFPUSHBUTTON;
    Window* const window = state.get();
    windows.push_back(std::move(state));
    if (!SetWindowSubclass(handle, window_proc, subclass_id, reinterpret_cast<DWORD_PTR>(window))) {
        windows.pop_back();
        return false;
    }
    if (owner_draw) {
        // Preserve HWND/class/ID: native keyboard, click notifications and accessibility stay intact.
        SetWindowLongPtrW(handle, GWL_STYLE, (style & ~BS_TYPEMASK) | BS_OWNERDRAW);
    }
    apply_colors(*window);
    themed_font(*window, reinterpret_cast<HFONT>(SendMessageW(handle, WM_GETFONT, 0, 0)));
    if (window->heading) {
        wchar_t caption[1024]{};
        GetWindowTextW(handle, caption, static_cast<int>(std::size(caption)));
        uppercase_heading(handle, caption);
    }
    return true;
}

BOOL CALLBACK attach_child(HWND handle, LPARAM) noexcept {
    try {
        return attach_window(handle) ? TRUE : FALSE;
    } catch (const std::bad_alloc&) {
        return FALSE; // Keep native controls usable if optional visual styling cannot be allocated.
    }
}

void detach_windows() noexcept {
    for (const auto& window : windows) {
        if (!IsWindow(window->handle)) continue;
        RemoveWindowSubclass(window->handle, window_proc, subclass_id);
        if (window->original_font)
            SendMessageW(window->handle, WM_SETFONT, reinterpret_cast<WPARAM>(window->original_font), FALSE);
        if (window->owner_draw) {
            const auto style = GetWindowLongPtrW(window->handle, GWL_STYLE);
            SetWindowLongPtrW(window->handle, GWL_STYLE, (style & ~BS_TYPEMASK)
                | (window->default_button ? BS_DEFPUSHBUTTON : BS_PUSHBUTTON));
        }
    }
    windows.clear();
    root = nullptr;
}

UINT_PTR __cdecl plugin_callback(NSPIM message) noexcept {
    if (message == NSPIM_GUIUNLOAD || message == NSPIM_UNLOAD) {
        detach_windows();
        for (auto& font : private_fonts) {
            if (font) RemoveFontMemResourceEx(font);
            font = nullptr;
        }
        sidebar_art.release();
        header_art.release();
    }
    return 0;
}
}

// Fonts and original bitmaps are loaded before any dialog is created.
extern "C" __declspec(dllexport) void __cdecl InitTheme(
    HWND, int, wchar_t*, stack_t** stack, extra_parameters* extra) noexcept {
    const bool can_style = register_plugin(extra);
    if (can_style) load_fonts();
    for (auto* art : {&sidebar_art, &header_art}) {
        if (!stack || !*stack) return;
        auto* argument = *stack;
        *stack = argument->next;
        if (can_style && !art->dc && argument->text[0]) art->load(argument->text);
        GlobalFree(argument);
    }
}

// No NSIS stack arguments or return value. RegisterPluginCallback pins the DLL until NSIS unloads it;
// /NOUNLOAD is also required at every script call. SDK callbacks use __cdecl; registration uses __stdcall.
extern "C" __declspec(dllexport) void __cdecl Apply(HWND parent, int, wchar_t*, stack_t**, extra_parameters* extra) noexcept {
    if (!parent || !IsWindow(parent) || GetWindowThreadProcessId(parent, nullptr) != GetCurrentThreadId()) return;
    if (!register_plugin(extra)) return;
    if (root && root != parent) return;
    root = parent;
    high_contrast = is_high_contrast();
    try {
        if (!attach_window(parent)) return;
        EnumChildWindows(parent, attach_child, 0); // Win32 already enumerates all descendants once.
        update_caption();
        RedrawWindow(parent, nullptr, nullptr, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN);
    } catch (const std::bad_alloc&) {
        // Styling is optional; never interrupt installation or cross the C plugin ABI with an exception.
    }
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) module = instance;
    return TRUE;
}
