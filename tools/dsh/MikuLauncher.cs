using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using System.Xml;

internal static class MikuLauncher
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string entry = Path.Combine(root, @"integrations\dsh\runtime\bootstrap.cjs");
            string electron = Path.Combine(root, @"electron\electron.exe");
            if (!File.Exists(electron))
                electron = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    @".dsh\electron\electron.exe");
            if (!File.Exists(entry)) throw new FileNotFoundException("找不到桌宠程序，请在项目目录重新构建。");
            if (!File.Exists(electron)) throw new FileNotFoundException("找不到本机的桌宠播放组件。");

            var start = new ProcessStartInfo(electron, "\"" + entry + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(entry),
            };
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            start.EnvironmentVariables["MIKU_TOPMOST"] = ReadTopmost(root) ? "true" : "false";
            using (Process process = Process.Start(start)) { }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Miku 桌宠", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static bool ReadTopmost(string root)
    {
        var document = new XmlDocument { XmlResolver = null };
        try
        {
            document.Load(Path.Combine(root, @"datafilm\settings.xml"));
            var node = document.SelectSingleNode("/*/AlwaysOnTop");
            bool topmost;
            return node == null || !bool.TryParse(node.InnerText, out topmost) || topmost;
        }
        catch (IOException) { return true; }
        catch (XmlException) { return true; }
    }
}
