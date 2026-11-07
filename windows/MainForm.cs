using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Reflection;

namespace PXLStudio;

internal sealed class MainForm : Form
{
    private const string VirtualHost = "pxl.local";
    private readonly WebView2 _webView = new();
    private readonly string _webRoot = Path.Combine(Path.GetTempPath(), "PXLStudio", "Web");
    private readonly string _userDataRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PXL Studio",
        "WebView2");
    private bool _initializing;

    public MainForm()
    {
        Text = "PXL Studio";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 620);
        Size = new Size(1440, 900);
        BackColor = Color.FromArgb(17, 18, 23);
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? "") ?? System.Drawing.SystemIcons.Application;

        _webView.Dock = DockStyle.Fill;
        _webView.DefaultBackgroundColor = Color.FromArgb(17, 18, 23);
        Controls.Add(_webView);

        Shown += InitializeWebViewAsync;
    }

    private async void InitializeWebViewAsync(object? sender, EventArgs e)
    {
        if (_initializing)
            return;

        _initializing = true;
        UseWaitCursor = true;

        try
        {
            ExtractWebAssets();
            Directory.CreateDirectory(_userDataRoot);

            // WebView2 Runtime is supplied by Windows/Edge, not downloaded by this app.
            string? runtimeVersion = CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (string.IsNullOrWhiteSpace(runtimeVersion))
                throw new InvalidOperationException("Microsoft Edge WebView2 Runtime не знайдено.");

            var environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: _userDataRoot);

            await _webView.EnsureCoreWebView2Async(environment);

            CoreWebView2 core = _webView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;

            // A local virtual HTTPS origin keeps file access and browser APIs working
            // without requiring a web server or an internet connection.
            core.SetVirtualHostNameToFolderMapping(
                VirtualHost,
                _webRoot,
                CoreWebView2HostResourceAccessKind.Allow);

            core.DownloadStarting += HandleDownloadStarting;
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.NavigationStarting += (_, args) =>
            {
                if (!args.Uri.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase))
                    args.Cancel = true;
            };

            _webView.Source = new Uri($"https://{VirtualHost}/index.html");
        }
        catch (Exception ex)
        {
            string message = ex.Message;
            MessageBox.Show(
                this,
                "Не вдалося запустити PXL Studio.\n\n" + message +
                "\n\nПотрібен Microsoft Edge WebView2 Runtime. У Windows 11 він зазвичай уже є. " +
                "Для Windows 10 його можна встановити з офіційної сторінки Microsoft:",
                "PXL Studio — помилка запуску",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);

            try
            {
                Process.Start(new ProcessStartInfo(
                    "https://developer.microsoft.com/microsoft-edge/webview2/"
                ) { UseShellExecute = true });
            }
            catch
            {
                // Opening the download page is optional; the error above is sufficient.
            }

            Close();
        }
        finally
        {
            UseWaitCursor = false;
        }
    }

    private void ExtractWebAssets()
    {
        Directory.CreateDirectory(_webRoot);

        ExtractResource("PXLStudio.Assets.index.html", "index.html");
        ExtractResource("PXLStudio.Assets.paint.css", "paint.css");
        ExtractResource("PXLStudio.Assets.paint.js", "paint.js");
    }

    private void ExtractResource(string resourceName, string fileName)
    {
        using Stream resource = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Вбудований файл {fileName} не знайдено.");

        string targetPath = Path.Combine(_webRoot, fileName);
        using FileStream output = File.Create(targetPath);
        resource.CopyTo(output);
    }

    private void HandleDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        string suggestedName = Path.GetFileName(e.DownloadOperation.ResultFilePath);
        if (string.IsNullOrWhiteSpace(suggestedName))
            suggestedName = "pxl-studio-export";

        string extension = Path.GetExtension(suggestedName).ToLowerInvariant();
        string filter = extension switch
        {
            ".pxl" => "PXL-проєкт (*.pxl)|*.pxl|Усі файли (*.*)|*.*",
            ".png" => "Зображення PNG (*.png)|*.png|Усі файли (*.*)|*.*",
            _ => "Усі файли (*.*)|*.*"
        };

        using var dialog = new SaveFileDialog
        {
            Title = "Зберегти файл PXL Studio",
            FileName = suggestedName,
            Filter = filter,
            DefaultExt = extension.TrimStart('.'),
            AddExtension = true,
            OverwritePrompt = true,
            RestoreDirectory = true
        };

        string downloads = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Downloads");
        if (Directory.Exists(downloads))
            dialog.InitialDirectory = downloads;

        // Replace the browser's download UI with the normal Windows Save dialog.
        e.Handled = true;
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            e.ResultFilePath = dialog.FileName;
        }
        else
        {
            e.Cancel = true;
        }
    }
}
