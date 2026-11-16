using System;
using System.Windows;
using System.Windows.Controls;

namespace MikuPet
{
    // A visible, disposable harness for the upstream runtime's own window smoke check.
    internal static class VideoCheck
    {
        [STAThread] public static void Main()
        {
            var app=new Application();
            var text=new TextBlock{Text="正在准备 Miku 的透明视频窗口…",Margin=new Thickness(24),TextWrapping=TextWrapping.Wrap};
            var window=new Window{Title="Miku · 视频桌宠检查",Width=420,Height=160,Content=text};
            System.Diagnostics.Process process=null;
            window.Loaded+=delegate
            {
                try
                {
                    process=VideoTrial.Start(true,true);
                    process.Exited+=delegate{window.Dispatcher.BeginInvoke(new Action(delegate{text.Text="窗口检查已结束。请查看项目中的检查记录。";}));};
                    process.EnableRaisingEvents=true;
                }
                catch(Exception e){text.Text=e.Message;}
            };
            window.Closed+=delegate{if(process!=null){try{if(!process.HasExited)process.Kill();}catch(InvalidOperationException){}process.Dispose();}};
            app.Run(window);
        }
    }
}
