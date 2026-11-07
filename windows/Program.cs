namespace PXLStudio;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        // Prevent two windows from sharing one WebView2 user-data folder.
        using var mutex = new Mutex(
            initiallyOwned: true,
            name: @"Local\PXLStudio.Desktop.SingleInstance",
            createdNew: out bool isFirstInstance);

        if (!isFirstInstance)
        {
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
