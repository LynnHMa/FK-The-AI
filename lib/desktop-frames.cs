using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Threading;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Runtime.InteropServices;

// WPF's render clock owns motion. PowerShell only handles infrequent controls.
public sealed class FKPetMotion : IDisposable {
 [StructLayout(LayoutKind.Sequential)] struct CursorPoint {public int X,Y;}
 [DllImport("user32.dll")] static extern bool GetCursorPos(out CursorPoint p);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [StructLayout(LayoutKind.Sequential)] struct NativeRect {public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential)] struct MonitorInfo {public int Size;public NativeRect Monitor,Work;public int Flags;}
 [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(CursorPoint p,uint flags);
 [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
 readonly Window window;readonly Image image;readonly FKPetShape shape;readonly TransformGroup transform;readonly ScaleTransform scale;readonly RotateTransform rotate;
 readonly Stopwatch clock=Stopwatch.StartNew();double last,ox,oy,sampleAt;int sampleFrames;long frames;
 public bool Enabled=true,Gravity=true;public bool Dragging {get;private set;}
 public event EventHandler DoubleClick;
 public double Vx,Vy,Fps,MaxFrameMs;public long Frames {get{return frames;}}
 public FKPetMotion(Window w,Image i,FKPetShape s,TransformGroup t,ScaleTransform stretch,RotateTransform rotation){window=w;image=i;shape=s;transform=t;scale=stretch;rotate=rotation;CompositionTarget.Rendering+=Tick;image.MouseLeftButtonDown+=Down;image.MouseLeftButtonUp+=Up;image.LostMouseCapture+=Lost;}
 void Down(object sender,System.Windows.Input.MouseButtonEventArgs e){
  if(!Enabled||!shape.Contains(e.GetPosition(image)))return;
  if(e.ClickCount>=2){Reset();image.ReleaseMouseCapture();var handler=DoubleClick;if(handler!=null)handler(this,EventArgs.Empty);}
  else{BeginDrag();image.CaptureMouse();}e.Handled=true;
 }
 void Up(object sender,System.Windows.Input.MouseButtonEventArgs e){EndDrag();image.ReleaseMouseCapture();}
 void Lost(object sender,System.Windows.Input.MouseEventArgs e){EndDrag();}
 public void BeginDrag(){var p=Cursor();ox=p.X-window.Left;oy=p.Y-window.Top;Dragging=true;MaxFrameMs=0;}
 public void EndDrag(){Dragging=false;}
 public void Reset(){Dragging=false;Vx=Vy=0;last=clock.Elapsed.TotalSeconds;}
 Point Cursor(){CursorPoint p;GetCursorPos(out p);return PresentationSource.FromVisual(window).CompositionTarget.TransformFromDevice.Transform(new Point(p.X,p.Y));}
 void Tick(object sender,EventArgs e){
  double now=clock.Elapsed.TotalSeconds,elapsed=now-last;last=now;if(!Enabled||!window.IsVisible||!window.IsLoaded)return;
  frames++;sampleFrames++;if(now-sampleAt>=1){Fps=sampleFrames/(now-sampleAt);sampleFrames=0;sampleAt=now;}if(Dragging)MaxFrameMs=Math.Max(MaxFrameMs,elapsed*1000);
  if(Dragging&&GetAsyncKeyState(1)>=0){Dragging=false;image.ReleaseMouseCapture();}
  var source=PresentationSource.FromVisual(window);if(source==null)return;var matrix=source.CompositionTarget.TransformFromDevice;
  CursorPoint device;GetCursorPos(out device);if(!Dragging){var center=source.CompositionTarget.TransformToDevice.Transform(new Point(window.Left+150,window.Top+210));device.X=(int)center.X;device.Y=(int)center.Y;}
  var info=new MonitorInfo();info.Size=Marshal.SizeOf(info);GetMonitorInfo(MonitorFromPoint(device,2),ref info);
  var a=matrix.Transform(new Point(info.Work.Left,info.Work.Top));var z=matrix.Transform(new Point(info.Work.Right,info.Work.Bottom));var pointer=Cursor();
  // Substeps keep the spring stable if the compositor skips a frame.
  double remaining=Math.Min(.05,Math.Max(0,elapsed));while(remaining>0){double dt=Math.Min(1.0/120,remaining);remaining-=dt;
   if(Dragging){Vx+=((pointer.X-ox-window.Left)*190-Vx*25)*dt;Vy+=((pointer.Y-oy-window.Top)*190-Vy*25+(Gravity?850:0))*dt;}
   else {if(Gravity)Vy+=1100*dt;else Vy*=Math.Exp(-1.4*dt);Vx*=Math.Exp(-.35*dt);}
   Vx=Math.Max(-1800,Math.Min(1800,Vx));Vy=Math.Max(-1800,Math.Min(1800,Vy));window.Left+=Vx*dt;window.Top+=Vy*dt;
  }
  rotate.Angle=Math.Max(-23,Math.Min(23,-Vx*.035));scale.ScaleY=1+Math.Min(.10,Math.Abs(Vy)*.00008);scale.ScaleX=1/Math.Sqrt(scale.ScaleY);
  var b=shape.Bounds(transform);
  if(window.Top+b.Bottom>z.Y){window.Top=z.Y-b.Bottom;Vy=-Math.Abs(Vy)*.42;Vx*=.85;if(Math.Abs(Vy)<26)Vy=0;}
  if(window.Top+b.Top<a.Y){window.Top=a.Y-b.Top;Vy=Math.Abs(Vy)*.4;}
  if(window.Left+b.Left<a.X){window.Left=a.X-b.Left;Vx=Math.Abs(Vx)*.5;}
  if(window.Left+b.Right>z.X){window.Left=z.X-b.Right;Vx=-Math.Abs(Vx)*.5;}
 }
 public void Dispose(){CompositionTarget.Rendering-=Tick;image.MouseLeftButtonDown-=Down;image.MouseLeftButtonUp-=Up;image.LostMouseCapture-=Lost;}
}

public sealed class FKStateReader : IDisposable {
 readonly string path;readonly Thread thread;volatile bool disposed;public string Text {get;private set;}
 public FKStateReader(string file){path=file;thread=new Thread(Read);thread.IsBackground=true;thread.Start();}
 void Read(){while(!disposed){try{Text=File.ReadAllText(path);}catch(IOException){}Thread.Sleep(80);}}
 public void Dispose(){disposed=true;}
}

// The pet's contact support and pointer tests come from rendered alpha pixels.
public sealed class FKPetShape {
 readonly List<Point> edge=new List<Point>();byte[] pixels;int width,height;
 public void Update(BitmapSource source){
  var converted=new FormatConvertedBitmap(source,PixelFormats.Bgra32,null,0);width=converted.PixelWidth;height=converted.PixelHeight;pixels=new byte[width*height*4];converted.CopyPixels(pixels,width*4,0);edge.Clear();
  for(int y=0;y<height;y++){int left=width,right=-1;for(int x=0;x<width;x++)if(pixels[(y*width+x)*4+3]!=0){left=Math.Min(left,x);right=x;}
   if(right>=left){edge.Add(new Point(left,y));edge.Add(new Point(right+1,y));edge.Add(new Point(left,y+1));edge.Add(new Point(right+1,y+1));}
  }
 }
 public bool Contains(Point point){int x=(int)Math.Floor(point.X),y=(int)Math.Floor(point.Y);return pixels!=null&&x>=0&&y>=0&&x<width&&y<height&&pixels[(y*width+x)*4+3]!=0;}
 public Rect Bounds(Transform transform){
  double left=Double.PositiveInfinity,right=Double.NegativeInfinity,top=Double.PositiveInfinity,bottom=Double.NegativeInfinity;
  foreach(var p in edge){var v=transform.Transform(new Point(p.X-150,p.Y-28));left=Math.Min(left,v.X+150);right=Math.Max(right,v.X+150);top=Math.Min(top,v.Y+98);bottom=Math.Max(bottom,v.Y+98);}
  return edge.Count>0?new Rect(left,top,right-left,bottom-top):new Rect(150,210,0,0);
 }
}

// Pixel transport and presentation run in C#, outside PowerShell's event loop.
public sealed class FKFrameStream : IDisposable {
 sealed class Rect { public int X,Y,W,H,Offset; }
 sealed class Frame { public int Width,Height,Sequence; public byte[] Pixels; public List<Rect> Regions; }
 sealed class Tile { public Image Image;public WriteableBitmap Bitmap;public int Sequence; }
 readonly object gate=new object(); readonly Queue<byte[]> pool=new Queue<byte[]>();
 readonly string name; readonly Canvas layer;readonly Dictionary<string,Tile> tiles=new Dictionary<string,Tile>();
 readonly Stopwatch clock=Stopwatch.StartNew();
 Thread reader; NamedPipeServerStream pipe; Frame latest; volatile bool disposed;
 long received,presented,dropped; double sampleAt; long sampleFrames;
 public double Fps {get;private set;} public string Error {get;private set;}
 public string Phase {get;private set;} public long BytesRead {get;private set;}
 public int PixelWidth {get;private set;} public int PixelHeight {get;private set;}
 public long Received {get{return Interlocked.Read(ref received);}}
 public long Presented {get{return Interlocked.Read(ref presented);}}
 public long Dropped {get{return Interlocked.Read(ref dropped);}}
 public FKFrameStream(string pipeName,Canvas target) {
  name=pipeName;layer=target;Error="";
  CompositionTarget.Rendering+=Present;
  reader=new Thread(ReadLoop);reader.IsBackground=true;reader.Name="FK desktop pixels";reader.Start();
 }
 byte[] Rent(int length){lock(gate){while(pool.Count>0){var b=pool.Dequeue();if(b.Length>=length)return b;}}return new byte[((length+65535)/65536)*65536];}
 void Return(byte[] buffer){lock(gate){if(pool.Count<3)pool.Enqueue(buffer);}}
 void ReadExactly(Stream stream,byte[] buffer,int length){int offset=0;while(offset<length){int n=stream.Read(buffer,offset,length-offset);if(n==0)throw new EndOfStreamException();offset+=n;BytesRead+=n;}}
 void ReadLoop(){
  while(!disposed){
   try{
    using(var server=new NamedPipeServerStream(name,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.None,65536,65536)){
     pipe=server;Phase="waiting";server.WaitForConnection();var header=new byte[24];
     while(!disposed){
      Phase="header";ReadExactly(server,header,header.Length);if(BitConverter.ToInt32(header,0)!=0x464B5032)throw new IOException("Invalid desktop frame");
      var f=new Frame{Width=BitConverter.ToInt32(header,4),Height=BitConverter.ToInt32(header,8),Sequence=BitConverter.ToInt32(header,16),Regions=new List<Rect>()};
      int count=BitConverter.ToInt32(header,12),length=BitConverter.ToInt32(header,20);
      if(f.Width<1||f.Height<1||f.Width>16000||f.Height>10000||count<0||count>4096||length<0||length>(long)f.Width*f.Height*4+count*16)throw new IOException("Invalid desktop dimensions");
      Phase="pixels:"+length;f.Pixels=Rent(length);ReadExactly(server,f.Pixels,length);Interlocked.Increment(ref received);
      int offset=0;for(int i=0;i<count;i++){
       if(offset+16>length)throw new IOException("Invalid desktop tile");var r=new Rect{X=BitConverter.ToInt32(f.Pixels,offset),Y=BitConverter.ToInt32(f.Pixels,offset+4),W=BitConverter.ToInt32(f.Pixels,offset+8),H=BitConverter.ToInt32(f.Pixels,offset+12),Offset=offset+16};
       if(r.X<0||r.Y<0||r.W<1||r.H<1||r.H>256||r.X+r.W>f.Width||r.Y+r.H>f.Height||r.Offset+(long)r.W*r.H*4>length)throw new IOException("Invalid desktop tile bounds");
       offset=r.Offset+r.W*r.H*4;f.Regions.Add(r);
      }
      lock(gate){if(latest!=null){Return(latest.Pixels);Interlocked.Increment(ref dropped);}latest=f;}
     }
    }
   }catch(EndOfStreamException){}catch(IOException e){if(!disposed)Error=e.Message;}catch(ObjectDisposedException){}catch(Exception e){if(!disposed)Error=e.Message;}
   finally{pipe=null;}
  }
 }
 void Present(object sender,EventArgs e){
  Frame frame;lock(gate){frame=latest;latest=null;}if(frame==null)return;
  try{
   PixelWidth=frame.Width;PixelHeight=frame.Height;
   var source=PresentationSource.FromVisual(layer);if(source==null)return;var dip=source.CompositionTarget.TransformFromDevice;
   foreach(var r in frame.Regions){
    string key=r.X+","+r.Y;Tile tile;
    if(!tiles.TryGetValue(key,out tile)||tile.Bitmap.PixelWidth!=r.W||tile.Bitmap.PixelHeight!=r.H){
     if(tile!=null)layer.Children.Remove(tile.Image);tile=new Tile{Image=new Image{IsHitTestVisible=false,SnapsToDevicePixels=true},Bitmap=new WriteableBitmap(r.W,r.H,96,96,PixelFormats.Pbgra32,null)};
     tile.Image.Source=tile.Bitmap;tile.Image.Width=r.W*dip.M11;tile.Image.Height=r.H*dip.M22;Canvas.SetLeft(tile.Image,r.X*dip.M11);Canvas.SetTop(tile.Image,r.Y*dip.M22);layer.Children.Add(tile.Image);tiles[key]=tile;
    }
    tile.Bitmap.WritePixels(new Int32Rect(0,0,r.W,r.H),frame.Pixels,r.W*4,r.Offset);tile.Image.Visibility=Visibility.Visible;tile.Sequence=frame.Sequence;
   }
   foreach(var tile in tiles.Values)if(tile.Sequence!=frame.Sequence)tile.Image.Visibility=Visibility.Collapsed;
   Interlocked.Increment(ref presented);
   double now=clock.Elapsed.TotalSeconds;if(now-sampleAt>=1){Fps=(Presented-sampleFrames)/(now-sampleAt);sampleAt=now;sampleFrames=Presented;}
  }catch(Exception error){Error=error.Message;}finally{Return(frame.Pixels);}
 }
 public void Dispose(){disposed=true;CompositionTarget.Rendering-=Present;var current=pipe;if(current!=null)current.Dispose();lock(gate){if(latest!=null){Return(latest.Pixels);latest=null;}}layer.Children.Clear();tiles.Clear();}
}
