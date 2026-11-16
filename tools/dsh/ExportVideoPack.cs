using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

// Sample the released character renderer, including its eye and lift timelines.
// Encoding changes the container; it does not invent additional character poses.
internal static class ExportVideoPack
{
    private const int W=640,H=360;
    [STAThread] private static void Main(string[] args)
    {
        if(args.Length!=3)throw new ArgumentException("Expected released exe, ffmpeg and new output directory");
        string exe=Path.GetFullPath(args[0]),encoder=Path.GetFullPath(args[1]),output=Path.GetFullPath(args[2]);
        if(Directory.Exists(output))throw new InvalidOperationException("Output already exists");
        Directory.CreateDirectory(output);
        var assembly=Assembly.LoadFrom(exe);
        var motion=assembly.GetType("MikuPet.FilmMotion",true);
        var type=assembly.GetType("MikuPet.MikuCharacter",true);
        var actionType=assembly.GetType("MikuPet.PetAction",true);
        var update=type.GetMethod("Update",BindingFlags.NonPublic|BindingFlags.Instance);
        var duration=motion.GetMethod("Duration",BindingFlags.NonPublic|BindingFlags.Static);
        string[] actions={"Idle","Wave","Pat","Sleep","Stretch","Shy","Nod","Walk","Drag","Land","Look","Hat","Umbrella","Dance","Hum","Sleep","Drag"};
        string[] names={"待机眨眼","挥挥手","开心回应","打个盹","慢慢醒来","害羞一下","打个招呼","散步一下","提起晃腿","落地站稳","左右张望","整理帽子","撑伞致意","轻快舞步","开心摇摆","睡梦中","悬空轻晃"};
        var clips=new System.Collections.Generic.List<object>();
        for(int n=0;n<actions.Length;n++)
        {
            object action=Enum.Parse(actionType,actions[n]);
            double seconds=n==15?3.5:n==16?1.2:n==3?1.1:(double)duration.Invoke(null,new[]{action});
            int fps=n==7||n==9?48:24, count=(int)Math.Ceiling(seconds*fps);
            var doll=(FrameworkElement)Activator.CreateInstance(type,true);
            doll.Measure(new Size(300,360));doll.Arrange(new Rect(0,0,300,360));doll.UpdateLayout();
            var brush=new VisualBrush(doll){ViewboxUnits=BrushMappingMode.Absolute,Viewbox=new Rect(0,0,300,360),Stretch=Stretch.Fill};
            var info=new ProcessStartInfo(encoder,"-hide_banner -loglevel error -y -f rawvideo -pixel_format bgra -video_size 640x360 -framerate "+fps+" -i pipe:0 -an -c:v libvpx-vp9 -pix_fmt yuva420p -lossless 1 -auto-alt-ref 0 -row-mt 1 -threads 4 -deadline good -cpu-used 4 \""+Path.Combine(output,names[n]+".webm")+"\"")
                {UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardError=true};
            var errors=new StringBuilder();
            using(var process=Process.Start(info))
            {
                process.ErrorDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(e.Data!=null)errors.AppendLine(e.Data);};process.BeginErrorReadLine();
                var bytes=new byte[W*H*4];
                for(int i=0;i<count;i++)
                {
                    double t=i/(double)fps, age=n==15?1.1+i*Math.PI*2/(count*1.8):n==16?.5+i*1.2/count:t;
                    update.Invoke(doll,new object[]{action,t,age,0.0,0.0,0.0,true});
                    doll.UpdateLayout();
                    var visual=new DrawingVisual();
                    using(var dc=visual.RenderOpen())dc.DrawRectangle(brush,null,new Rect(195,30,250,300));
                    var frame=new RenderTargetBitmap(W,H,96,96,PixelFormats.Pbgra32);frame.Render(visual);
                    new FormatConvertedBitmap(frame,PixelFormats.Bgra32,null,0).CopyPixels(bytes,W*4,0);
                    process.StandardInput.BaseStream.Write(bytes,0,bytes.Length);
                    if(i==0)
                    {
                        var png=new PngBitmapEncoder();png.Frames.Add(BitmapFrame.Create(frame));
                        using(var file=File.Create(Path.Combine(output,names[n]+".png")))png.Save(file);
                    }
                }
                process.StandardInput.Close();process.WaitForExit();
                if(process.ExitCode!=0)throw new InvalidOperationException("Encoding failed: "+names[n]+" "+errors);
            }
            clips.Add(new{name=names[n],action=actions[n],fps=fps,frames=count,duration=count/(double)fps});
            Console.WriteLine(names[n]+": "+count+" frames at "+fps+" Hz sampling");
            GC.Collect();GC.WaitForPendingFinalizers();GC.Collect();
        }
        string hash;using(var sha=SHA256.Create())using(var stream=File.OpenRead(exe))hash=BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","");
        File.WriteAllText(Path.Combine(output,"manifest.json"),new JavaScriptSerializer().Serialize(new{sourceExecutableSha256=hash,width=W,height=H,clips=clips}),new UTF8Encoding(false));
    }
}
