using System.Runtime.InteropServices;

namespace FoxyJumpscare.Platform;

/// <summary>
/// WS_EX_NOACTIVATE keeps the overlay from taking focus or swallowing
/// keystrokes; WS_EX_TOOLWINDOW keeps it out of Alt-Tab. ShowActivated=false
/// alone is not sufficient - the window can still take focus on some
/// compositor paths, and a jumpscare that eats the sentence you were typing is
/// a bug, not a feature.
/// </summary>
public static class NoActivate
{
    private const int GwlExStyle = -20;
    private const int WsExNoActivate = 0x08000000;
    private const int WsExToolWindow = 0x00000080;

    [DllImport("user32.dll", SetLastError = true, EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true, EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    public static void Apply(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;

        var style = (long)GetWindowLongPtr(hwnd, GwlExStyle);
        var updated = style | WsExNoActivate | WsExToolWindow;
        SetWindowLongPtr(hwnd, GwlExStyle, new IntPtr(updated));
    }
}
