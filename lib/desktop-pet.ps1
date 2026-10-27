param([Parameter(Mandatory=$true)][string]$StatePath,[int]$HostProcessId=0,[string]$HostWindowTitle='')
$ErrorActionPreference='Stop'
$initial=Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8|ConvertFrom-Json
$script:language=$initial.language;$script:languageButtons=[Collections.ArrayList]::new();$script:languageStamp=''
function L($key,$values=@{}){
 $property=$script:language.PSObject.Properties[$key];$value=if($property){[string]$property.Value}else{$key}
 return [regex]::Replace($value,'\{(\w+)\}',[Text.RegularExpressions.MatchEvaluator]{param($match);$key=$match.Groups[1].Value;if($values.ContainsKey($key)){return [string]$values[$key]};return $match.Value})
}
function Apply-Language($language,$revision){
 if(!$language){return};$stamp=[string]$revision;if($stamp -eq $script:languageStamp){return};$script:languageStamp=$stamp;$script:language=$language
 foreach($binding in $script:languageButtons){$title=L $binding.title;$binding.titleText.Text=$title;$binding.detailText.Text=L $binding.detail;[Windows.Automation.AutomationProperties]::SetName($binding.button,$title)}
 if($script:exit){$script:exit.Header=L 'native.close'};if($script:window){$script:window.Title=L 'native.windowTitle'}
}

[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Windows.Forms,System.Xaml
Add-Type -Path (Join-Path $PSScriptRoot 'desktop-frames.cs') -ReferencedAssemblies @('System.dll','System.Core.dll',([System.Xaml.XamlReader].Assembly.Location),([Windows.Window].Assembly.Location),([Windows.Media.ImageSource].Assembly.Location),([Windows.Threading.Dispatcher].Assembly.Location))
Add-Type @'
using System;using System.Text;using System.Diagnostics;using System.Runtime.InteropServices;
public static class FKCursor {
 [StructLayout(LayoutKind.Sequential)]public struct Point{public int X;public int Y;}
 [StructLayout(LayoutKind.Sequential)]public struct Rect{public int Left;public int Top;public int Right;public int Bottom;}
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 public delegate bool EnumCallback(IntPtr hwnd,IntPtr data);
 [DllImport("user32.dll")]public static extern bool GetCursorPos(out Point point);
 [DllImport("user32.dll")]public static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumCallback cb,IntPtr data);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int max);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr hwnd,StringBuilder text,int max);
 [DllImport("user32.dll")]static extern int GetWindowLong(IntPtr hwnd,int index);
 [DllImport("user32.dll")]static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr hwnd,uint command);
 [DllImport("user32.dll")]static extern bool ShowWindowAsync(IntPtr hwnd,int command);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr hwnd);
 public static string LastHostTitle="";public static long LastHostHandle=0;
 public static bool RestoreHost(int expectedPid,string expectedTitle){
  IntPtr found=IntPtr.Zero;int best=-1;EnumWindows((hwnd,data)=>{
   uint pid;GetWindowThreadProcessId(hwnd,out pid);
   try{var p=Process.GetProcessById((int)pid);if(expectedPid>0?pid!=expectedPid:p.ProcessName!="DeepSeek Harness")return true;
    var title=new StringBuilder(512);GetWindowText(hwnd,title,512);
    if(!String.IsNullOrEmpty(expectedTitle)&&title.ToString()!=expectedTitle)return true;
    var cls=new StringBuilder(256);GetClassName(hwnd,cls,256);
    bool mainClass=expectedPid>0?cls.ToString().StartsWith("HwndWrapper["):cls.ToString()=="Chrome_WidgetWin_1";
    Rect rect;GetWindowRect(hwnd,out rect);
    if(mainClass&&((rect.Right-rect.Left>=200&&rect.Bottom-rect.Top>=100)||IsIconic(hwnd))&&(GetWindow(hwnd,4)==IntPtr.Zero||!String.IsNullOrEmpty(expectedTitle))&&title.Length>0){int score=(IsWindowVisible(hwnd)?1:0)+(title.ToString().IndexOf("DeepSeek",StringComparison.OrdinalIgnoreCase)>=0?2:0);if(score>best){best=score;found=hwnd;LastHostTitle=title.ToString();LastHostHandle=hwnd.ToInt64();}}
   }catch{}return true;
  },IntPtr.Zero);
  if(found==IntPtr.Zero)return false;ShowWindowAsync(found,9);SetForegroundWindow(found);return true;
 }
}
'@
$app=New-Object Windows.Application;$app.ShutdownMode='OnExplicitShutdown'
$window=New-Object Windows.Window;$window.Title=L 'native.windowTitle';$window.Width=300;$window.Height=350
$window.WindowStyle='None';$window.ResizeMode='NoResize';$window.AllowsTransparency=$true;$window.Background=[Windows.Media.Brushes]::Transparent
$window.Topmost=$true;$window.ShowInTaskbar=$false
$root=New-Object Windows.Controls.Canvas;$window.Content=$root
$buttonStyle=[Windows.Markup.XamlReader]::Parse(@'
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="Button">
 <Setter Property="FontFamily" Value="Segoe UI, Microsoft YaHei UI"/><Setter Property="FontSize" Value="11"/>
 <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button">
  <Border Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1" CornerRadius="7" Padding="{TemplateBinding Padding}">
   <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
  </Border>
 </ControlTemplate></Setter.Value></Setter>
</Style>
'@)
$petShape=[FKPetShape]::new()
$image=New-Object Windows.Controls.Image;$image.Width=300;$image.Height=280;$image.Cursor='Hand'
[Windows.Controls.Canvas]::SetTop($image,70);$root.Children.Add($image)|Out-Null
$image.RenderTransformOrigin=New-Object Windows.Point(0.5,0.1)
$transforms=New-Object Windows.Media.TransformGroup;$scale=New-Object Windows.Media.ScaleTransform;$rotate=New-Object Windows.Media.RotateTransform
$transforms.Children.Add($scale);$transforms.Children.Add($rotate);$image.RenderTransform=$transforms
$arenaImage=New-Object Windows.Controls.Canvas;$arenaImage.IsHitTestVisible=$false;$arenaImage.Visibility='Collapsed';$root.Children.Insert(0,$arenaImage)
$script:themeBrushes=@{}
foreach($entry in @{surface='#20201e';border='#4b4944';text='#ece3d1';muted='#bbb4a6';accent='#c4ac82';hover='#2e2e2b'}.GetEnumerator()){$script:themeBrushes[$entry.Key]=[Windows.Media.SolidColorBrush]::new([Windows.Media.ColorConverter]::ConvertFromString($entry.Value))}
$script:themeButtons=[Collections.ArrayList]::new();$script:themeStamp=''
function Theme-Brush($key){return $script:themeBrushes[$key]}
function Apply-Theme($palette){
 if(!$palette){return};$stamp=$palette|ConvertTo-Json -Compress;if($stamp -eq $script:themeStamp){return};$script:themeStamp=$stamp
 foreach($key in @('surface','border','text','muted','accent','hover')){if($palette.$key -match '^#[a-fA-F0-9]{6}$'){$script:themeBrushes[$key].Color=[Windows.Media.ColorConverter]::ConvertFromString($palette.$key)}}
 foreach($button in $script:themeButtons){$button.Background.BeginAnimation([Windows.Media.SolidColorBrush]::ColorProperty,$null);$button.Background.Color=(Theme-Brush 'surface').Color}
}
function Card {
 $card=New-Object Windows.Controls.Border;$card.Background=Theme-Brush 'surface'
 $card.BorderBrush=Theme-Brush 'border';$card.BorderThickness=New-Object Windows.Thickness(1)
 $card.CornerRadius=New-Object Windows.CornerRadius(8);$card.Padding=New-Object Windows.Thickness(11)
 $shadow=New-Object Windows.Media.Effects.DropShadowEffect;$shadow.BlurRadius=16;$shadow.ShadowDepth=3;$shadow.Opacity=0.25;$card.Effect=$shadow;return $card
}
function Button($label,$handler){
 $button=New-Object Windows.Controls.Button;$button.Content=$label;$button.Padding=New-Object Windows.Thickness(8,5,8,5);$button.Margin=New-Object Windows.Thickness(3)
 $button.Style=$buttonStyle;$button.Background=(Theme-Brush 'surface').Clone();$button.Foreground=Theme-Brush 'text';$script:themeButtons.Add($button)|Out-Null
 $button.BorderBrush=[Windows.Media.Brushes]::Transparent;$button.RenderTransform=New-Object Windows.Media.TranslateTransform
 $button.Add_MouseEnter({param($sender,$args)
  $color=New-Object Windows.Media.Animation.ColorAnimation;$color.To=(Theme-Brush 'hover').Color;$color.Duration=[TimeSpan]::FromMilliseconds(130);$sender.Background.BeginAnimation([Windows.Media.SolidColorBrush]::ColorProperty,$color)
  $lift=New-Object Windows.Media.Animation.DoubleAnimation;$lift.To=-1;$lift.Duration=[TimeSpan]::FromMilliseconds(130);$sender.RenderTransform.BeginAnimation([Windows.Media.TranslateTransform]::YProperty,$lift)
 })
 $button.Add_MouseLeave({param($sender,$args)
  $color=New-Object Windows.Media.Animation.ColorAnimation;$color.To=(Theme-Brush 'surface').Color;$color.Duration=[TimeSpan]::FromMilliseconds(160);$sender.Background.BeginAnimation([Windows.Media.SolidColorBrush]::ColorProperty,$color)
  $lift=New-Object Windows.Media.Animation.DoubleAnimation;$lift.To=0;$lift.Duration=[TimeSpan]::FromMilliseconds(160);$sender.RenderTransform.BeginAnimation([Windows.Media.TranslateTransform]::YProperty,$lift);$sender.Opacity=1
 })
 $button.Add_PreviewMouseLeftButtonDown({param($sender,$args);$sender.Opacity=0.65});$button.Add_PreviewMouseLeftButtonUp({param($sender,$args);$sender.Opacity=1})
 $button.Add_Click($handler);return $button
}
# Vector icons stay crisp at every Windows display scale.
$icons=@{
 arena='M 3,4 L 17,4 17,16 3,16 Z M 7,4 L 7,16 M 13,4 L 13,16 M 3,10 L 17,10'
 stats='M 3,17 L 3,11 M 10,17 L 10,4 M 17,17 L 17,8'
 desktop='M 2,3 L 18,3 18,14 2,14 Z M 7,18 L 13,18 M 10,14 L 10,18 M 8,7 L 12,7 M 10,5 L 10,10'
 gravity='M 10,2 L 10,14 M 6,10 L 10,14 14,10 M 3,18 L 17,18'
 fist='M 4,11 L 4,6 Q 4,4 6,4 L 14,4 Q 16,4 16,6 L 16,12 13,17 7,17 4,13 Z M 8,4 L 8,9 M 12,4 L 12,9'
 grab='M 4,12 L 3,9 Q 3,7 5,8 L 7,10 7,4 Q 8,2 9,4 L 9,9 10,3 Q 11,2 12,4 L 12,9 13,5 Q 14,4 15,6 L 15,10 16,8 Q 18,7 18,10 L 16,16 8,18 Z'
 blade='M 4,16 L 15,3 18,2 17,6 6,17 Z M 3,12 L 9,18 M 5,16 L 2,19'
 chainsaw='M 3,12 L 13,3 Q 18,0 19,5 L 19,7 9,16 Z M 3,12 L 1,15 5,19 9,16 M 12,5 L 15,8 M 15,2 L 18,5'
 hammer='M 3,3 L 15,3 15,9 3,9 Z M 8,9 L 8,18 11,18 11,9'
 tesla='M 12,1 L 4,11 10,11 8,19 16,8 10,8 Z'
 tear='M 2,3 L 7,7 4,11 8,17 M 18,3 L 13,7 16,11 12,17 M 9,2 L 11,6 8,10 12,14 10,19'
 blackhole='M 17,7 A 7,7 0 1 0 16,15 A 5,5 0 1 0 8,6 A 3,3 0 1 0 13,11'
 pistol='M 2,5 L 18,5 18,9 10,9 8,17 3,17 5,9 2,9 Z M 11,9 L 11,12 8,12'
 smg='M 1,5 L 19,5 19,9 11,9 11,15 8,15 8,10 6,17 2,17 4,9 1,9 Z M 13,9 L 13,13 16,13'
 shotgun='M 1,7 L 19,7 M 1,10 L 15,10 12,14 7,14 4,18 1,18 4,10 M 13,7 L 13,11'
 railgun='M 2,6 L 18,6 18,11 9,11 7,17 3,17 5,11 2,11 Z M 7,3 L 7,6 M 12,3 L 12,6 M 4,8 L 16,8'
 swear='M 3,3 L 17,3 17,14 9,14 5,18 5,14 3,14 Z M 7,7 L 9,11 M 9,7 L 7,11 M 12,7 L 14,11 M 14,7 L 12,11'
 reset='M 3,8 A 7,7 0 1 1 4,15 M 3,3 L 3,8 8,8'
 exit='M 8,3 L 3,3 3,17 8,17 M 8,10 L 18,10 M 14,6 L 18,10 14,14'
}
$icons.graph='M 1,2 L 6,2 6,7 1,7 Z M 14,2 L 19,2 19,7 14,7 Z M 8,13 L 13,13 13,18 8,18 Z M 6,5 L 10,10 14,5 M 10,10 L 10,13';$icons.shock=$icons.tesla;$icons.shred=$icons.tear
function Icon-Button($icon,$title,$detail,$handler){
 $titleKey=$title;$detailKey=$detail
 if($title.StartsWith('native.')){$title=L $title;$detail=L $detail}

 $drawing=New-Object Windows.Shapes.Path;$drawing.Data=[Windows.Media.Geometry]::Parse($icons[$icon]);$drawing.Stroke=Theme-Brush 'text';$drawing.StrokeThickness=1.5;$drawing.StrokeStartLineCap='Round';$drawing.StrokeEndLineCap='Round';$drawing.StrokeLineJoin='Round';$drawing.Width=20;$drawing.Height=20;$drawing.Stretch='Uniform'
 $button=Button $drawing $handler;$button.Width=42;$button.Height=38;$button.Padding=New-Object Windows.Thickness(10,8,10,8)
 [Windows.Automation.AutomationProperties]::SetName($button,$title)
 $tip=New-Object Windows.Controls.ToolTip;$tip.Background=Theme-Brush 'surface';$tip.Foreground=Theme-Brush 'text';$tip.BorderBrush=Theme-Brush 'border';$tip.Padding=New-Object Windows.Thickness(10,7,10,7);$tip.Placement='Bottom';$tip.VerticalOffset=7
 $tipStack=New-Object Windows.Controls.StackPanel;$tipTitle=New-Object Windows.Controls.TextBlock;$tipTitle.Text=$title;$tipTitle.FontWeight='SemiBold';$tipTitle.FontSize=12;$tipStack.Children.Add($tipTitle)|Out-Null
 $tipText=New-Object Windows.Controls.TextBlock;$tipText.Text=$detail;$tipText.Foreground=Theme-Brush 'muted';$tipText.FontSize=11;$tipText.Margin=New-Object Windows.Thickness(0,3,0,0);$tipStack.Children.Add($tipText)|Out-Null;$tip.Content=$tipStack;$button.ToolTip=$tip
 [Windows.Controls.ToolTipService]::SetInitialShowDelay($button,220);[Windows.Controls.ToolTipService]::SetShowDuration($button,15000)
 if($titleKey.StartsWith('native.')){$script:languageButtons.Add(@{button=$button;title=$titleKey;detail=$detailKey;titleText=$tipTitle;detailText=$tipText})|Out-Null}
 return $button
}
$hover=Card;$hover.Width=226;$hover.Visibility='Collapsed';[Windows.Controls.Canvas]::SetLeft($hover,37);[Windows.Controls.Canvas]::SetTop($hover,0)
$hoverStack=New-Object Windows.Controls.StackPanel;$hover.Child=$hoverStack;$hover.RenderTransform=New-Object Windows.Media.TranslateTransform
$name=New-Object Windows.Controls.TextBlock;$name.Foreground=Theme-Brush 'text';$name.FontWeight='SemiBold';$name.FontSize=12;$name.TextTrimming='CharacterEllipsis';$name.Margin=New-Object Windows.Thickness(5,0,5,5);$hoverStack.Children.Add($name)|Out-Null
$hoverButtons=New-Object Windows.Controls.StackPanel;$hoverButtons.Orientation='Horizontal';$hoverStack.Children.Add($hoverButtons)|Out-Null
$hoverButtons.Children.Add((Icon-Button 'arena' 'native.openArena' 'native.openArenaHint' {Add-Command 'openArena';Restore-Host}))|Out-Null
$hoverButtons.Children.Add((Icon-Button 'stats' 'native.stats' 'native.statsHint' {Add-Command 'openStats';Restore-Host}))|Out-Null
$hoverButtons.Children.Add((Icon-Button 'desktop' 'native.desktop' 'native.desktopHint' {Add-Command 'startArena'}))|Out-Null
$gravity=Icon-Button 'gravity' 'native.gravity' 'native.gravityHint' {Add-Command 'gravity' @{value=($script:state.gravity -eq $false)}}
$hoverButtons.Children.Add($gravity)|Out-Null;$root.Children.Add($hover)|Out-Null
$bubble=Card;$bubble.Width=280;$bubble.Visibility='Collapsed';[Windows.Controls.Canvas]::SetLeft($bubble,10);[Windows.Controls.Canvas]::SetTop($bubble,0)
$text=New-Object Windows.Controls.TextBlock;$text.Foreground=Theme-Brush 'text';$text.FontSize=12;$text.TextWrapping='Wrap';$text.MaxHeight=70;$bubble.Child=$text;$root.Children.Add($bubble)|Out-Null
$bar=Card;$bar.Visibility='Collapsed';[Windows.Controls.Canvas]::SetLeft($bar,12);[Windows.Controls.Canvas]::SetTop($bar,12)
$barStack=New-Object Windows.Controls.StackPanel;$bar.Child=$barStack
$hud=New-Object Windows.Controls.TextBlock;$hud.Foreground=Theme-Brush 'text';$hud.FontSize=13;$barStack.Children.Add($hud)|Out-Null
$weapons=New-Object Windows.Controls.WrapPanel;$barStack.Children.Add($weapons)|Out-Null
$weaponButtons=@{}

$frameStream=[FKFrameStream]::new($initial.pipeName,$arenaImage)
function Sync-Weapons($catalog){
 $stamp=($catalog|ConvertTo-Json -Depth 4 -Compress);if($script:weaponsStamp -eq $stamp){return};$script:weaponsStamp=$stamp;foreach($old in $weaponButtons.Values){$script:themeButtons.Remove($old)};$weapons.Children.Clear();$weaponButtons.Clear()
 foreach($weapon in $catalog){
  $icon=if($weapon.behavior){$weapon.behavior}else{$weapon.id};if(!$icons.ContainsKey($icon)){$icon='pistol'}
  $button=Icon-Button $icon $weapon.name ($weapon.key+' · '+$weapon.hint) {param($sender,$args);Add-Command 'weapon' @{weapon=$sender.Tag}}
  $button.Tag=$weapon.id;$weaponButtons[$weapon.id]=$button;$weapons.Children.Add($button)|Out-Null
 };$script:highlightWeapon=''
}
Sync-Weapons $initial.weapons
$actions=New-Object Windows.Controls.WrapPanel;$barStack.Children.Add($actions)|Out-Null
$actions.Children.Add((Icon-Button 'reset' 'native.reset' 'native.resetHint' {Add-Command 'reset'}))|Out-Null
$actions.Children.Add((Icon-Button 'exit' 'native.exitArena' 'native.exitArenaHint' {Add-Command 'stopArena'}))|Out-Null
$root.Children.Add($bar)|Out-Null
$menu=New-Object Windows.Controls.ContextMenu;$exit=New-Object Windows.Controls.MenuItem;$exit.Header=L 'native.close';$exit.Add_Click({$script:closedByUser=$true;Write-Status;$window.Close()});$menu.Items.Add($exit)|Out-Null;$image.ContextMenu=$menu;$menu.Background=Theme-Brush 'surface';$menu.Foreground=Theme-Brush 'text';$menu.BorderBrush=Theme-Brush 'border';$exit.Background=Theme-Brush 'surface';$exit.Foreground=Theme-Brush 'text'
$motion=[FKPetMotion]::new($window,$image,$petShape,$transforms,$scale,$rotate);$motion.Gravity=($initial.gravity -ne $false)
$stateReader=[FKStateReader]::new($StatePath);$script:lastStateText=''
$script:drag=$false;$script:pressed=$false;$script:vx=0.0;$script:vy=0.0;$script:ox=150.0;$script:oy=130.0;$script:mode='pet'
$script:lastImage='';$script:lastMessage='';$script:state=$initial;$script:lastRead=[DateTime]::MinValue;$script:messageUntil=[DateTime]::MinValue;$script:hoverUntil=[DateTime]::MinValue
$script:commands=New-Object Collections.ArrayList;$script:commandId=0;$script:lastMove=[DateTime]::MinValue;$script:lastArenaStamp=0;$script:lastSound=0;$script:soundPlayers=New-Object Collections.ArrayList
function Cursor-Dip {
 $point=New-Object FKCursor+Point;[FKCursor]::GetCursorPos([ref]$point)|Out-Null
 return [Windows.PresentationSource]::FromVisual($window).CompositionTarget.TransformFromDevice.Transform((New-Object Windows.Point($point.X,$point.Y)))
}
function Monitor-Bounds($work=$false){
 $point=New-Object FKCursor+Point;[FKCursor]::GetCursorPos([ref]$point)|Out-Null
 if(!$motion.Dragging -and ![double]::IsNaN($window.Left)){
  $device=[Windows.PresentationSource]::FromVisual($window).CompositionTarget.TransformToDevice.Transform((New-Object Windows.Point(($window.Left+150),($window.Top+210))))
  $point.X=[int]$device.X;$point.Y=[int]$device.Y
 }
 $screen=[Windows.Forms.Screen]::FromPoint((New-Object Drawing.Point($point.X,$point.Y)))
 $bounds=if($work){$screen.WorkingArea}else{$screen.Bounds};$matrix=[Windows.PresentationSource]::FromVisual($window).CompositionTarget.TransformFromDevice
 $a=$matrix.Transform((New-Object Windows.Point($bounds.Left,$bounds.Top)));$b=$matrix.Transform((New-Object Windows.Point($bounds.Right,$bounds.Bottom)))
 return @{left=$a.X;top=$a.Y;right=$b.X;bottom=$b.Y;width=$b.X-$a.X;height=$b.Y-$a.Y}
}
function Body-Bounds {
 if($image.Source){$b=$petShape.Bounds($transforms);return @{left=$b.Left;right=$b.Right;top=$b.Top;bottom=$b.Bottom}}
 return @{left=150;right=150;top=210;bottom=210}
}
function Restore-Host {if([FKCursor]::RestoreHost($HostProcessId,$HostWindowTitle)){$script:hostRestores++}else{$text.Text=L 'native.hostMissing';$script:messageUntil=[DateTime]::UtcNow.AddSeconds(4)}}
function Show-Hover($show){
 if($script:menuShowing -eq $show){return};$script:menuShowing=$show
 $animation=New-Object Windows.Media.Animation.DoubleAnimation;$animation.Duration=[TimeSpan]::FromMilliseconds(150)
 if($show){
  $hover.Visibility='Visible';$animation.From=0;$animation.To=1
  $lift=New-Object Windows.Media.Animation.DoubleAnimation;$lift.From=7;$lift.To=0;$lift.Duration=[TimeSpan]::FromMilliseconds(180)
  $ease=New-Object Windows.Media.Animation.QuadraticEase;$ease.EasingMode='EaseOut';$lift.EasingFunction=$ease;$hover.RenderTransform.BeginAnimation([Windows.Media.TranslateTransform]::YProperty,$lift)
 }else{$animation.To=0;$animation.Add_Completed({if(!$script:menuShowing){$hover.Visibility='Collapsed'}})}
 $hover.BeginAnimation([Windows.UIElement]::OpacityProperty,$animation)
}
function Add-Command($action,$data=@{}){
 $script:commandId++;$command=@{id=$script:commandId;action=$action};foreach($key in $data.Keys){$command[$key]=$data[$key]}
 if($script:commands.Count -lt 256){$script:commands.Add($command)|Out-Null};Write-Status
}
function Arena-Input($action,$e){$p=$e.GetPosition($root);Add-Command $action @{x=$p.X;y=$p.Y}}
$motion.Add_DoubleClick({Restore-Host})
$window.Add_PreviewMouseLeftButtonDown({param($sender,$e)
 if($script:mode -ne 'arena' -or $bar.IsMouseOver){return};$script:pressed=$true;Arena-Input 'down' $e;$window.CaptureMouse()|Out-Null;$e.Handled=$true
})
$window.Add_PreviewMouseMove({param($sender,$e)
 if($script:mode -ne 'arena' -or $bar.IsMouseOver){return};$now=[DateTime]::UtcNow;if(($now-$script:lastMove).TotalMilliseconds -ge 12){Arena-Input 'move' $e;$script:lastMove=$now}
})
$window.Add_PreviewMouseLeftButtonUp({param($sender,$e)
 if($script:mode -eq 'arena' -and $script:pressed){Arena-Input 'up' $e;$script:pressed=$false;$window.ReleaseMouseCapture();$e.Handled=$true}
})
$window.Add_Deactivated({if($script:pressed){Add-Command 'cancel' @{x=0;y=0};$script:pressed=$false;$window.ReleaseMouseCapture()}})
$window.Add_PreviewKeyDown({param($sender,$e)
 if($script:mode -ne 'arena'){return};if($e.Key -eq 'Escape'){Add-Command 'stopArena';$e.Handled=$true;return}
 if($e.Key -eq 'R'){Add-Command 'reset';$e.Handled=$true;return}
 $keys=@('D1','D2','D3','D4','D5','D6','D7','D8','D9','D0','OemMinus','OemPlus','Oem5');$index=[Array]::IndexOf($keys,$e.Key.ToString())
 if($index -ge 0 -and $index -lt $script:state.weapons.Count){Add-Command 'weapon' @{weapon=$script:state.weapons[$index].id};$e.Handled=$true}
})
$window.Add_SourceInitialized({
 $area=Monitor-Bounds $true;$window.Left=$area.right-320;$window.Top=$area.top+100
 if($null -ne $initial.desktopX -and $null -ne $initial.desktopY){$window.Left=[double]$initial.desktopX;$window.Top=[double]$initial.desktopY}
})
function Write-Status {
 try{
  if(!$window.IsLoaded){return};$matrix=[Windows.PresentationSource]::FromVisual($window).CompositionTarget.TransformToDevice
  $bounds=Body-Bounds;$screen=Monitor-Bounds
  @{closedByUser=($script:closedByUser -eq $true);theme=$script:state.theme;handle=([Windows.Interop.WindowInteropHelper]::new($window)).Handle.ToInt64();imageHash=$script:imageHash;scaleX=$matrix.M11;scaleY=$matrix.M22;left=$window.Left;top=$window.Top;width=$window.Width;height=$window.Height;vx=$motion.Vx;vy=$motion.Vy;dragging=$motion.Dragging;motion=@{fps=$motion.Fps;frames=$motion.Frames;maxFrameMs=$motion.MaxFrameMs};visible=$window.IsVisible;image=($null -ne $image.Source);ticks=$script:ticks;mode=$script:mode;gravity=($script:state.gravity -ne $false);bounds=$bounds;screen=$screen;hover=($hover.Visibility -eq 'Visible');name=$name.Text;commands=@($script:commands);hostRestores=$script:hostRestores;restoredTitle=[FKCursor]::LastHostTitle;restoredHandle=[FKCursor]::LastHostHandle;render=@{fps=$frameStream.Fps;received=$frameStream.Received;presented=$frameStream.Presented;dropped=$frameStream.Dropped;width=$frameStream.PixelWidth;height=$frameStream.PixelHeight;error=$frameStream.Error;phase=$frameStream.Phase;bytes=$frameStream.BytesRead}}|ConvertTo-Json -Depth 7 -Compress|ForEach-Object {[IO.File]::WriteAllText((Join-Path (Split-Path $StatePath) 'ready.json'),$_,[Text.UTF8Encoding]::new($false))}
 }catch [System.IO.IOException]{}
}
function Set-Bitmap($target,$bytes){
 $stream=New-Object IO.MemoryStream(,$bytes);try{$bitmap=New-Object Windows.Media.Imaging.BitmapImage;$bitmap.BeginInit();$bitmap.CacheOption='OnLoad';$bitmap.StreamSource=$stream;$bitmap.EndInit();$bitmap.Freeze();$target.Source=$bitmap;if($target -eq $image){$petShape.Update($bitmap)}}finally{$stream.Dispose()}
}
function Change-Mode($mode){
 if($script:mode -eq $mode){return};$motion.Reset();$motion.Enabled=($mode -ne 'arena');$script:drag=$false;$script:pressed=$false;$image.ReleaseMouseCapture();$window.ReleaseMouseCapture();$script:vx=$script:vy=0
 if($mode -eq 'arena'){
  $script:petLeft=$window.Left;$script:petTop=$window.Top;$screen=$script:state.screen
  $window.Left=$screen.left;$window.Top=$screen.top;$window.Width=$screen.width;$window.Height=$screen.height
  $arenaImage.Width=$screen.width;$arenaImage.Height=$screen.height;$bar.MaxWidth=[Math]::Max(300,$screen.width-24);$weapons.MaxWidth=[Math]::Max(260,$screen.width-70)
  $window.Background=New-Object Windows.Media.SolidColorBrush([Windows.Media.Color]::FromArgb(1,0,0,0))
  $image.Visibility=$hover.Visibility=$bubble.Visibility='Collapsed';$arenaImage.Visibility=$bar.Visibility='Visible';$window.Activate()|Out-Null;$window.Focus()|Out-Null
 }else{
  $window.Width=300;$window.Height=350;$window.Left=$script:petLeft;$window.Top=$script:petTop
  if($script:state.returnPosition){$window.Left=$script:state.returnPosition.x;$window.Top=$script:state.returnPosition.y}
  $window.Background=[Windows.Media.Brushes]::Transparent;$arenaImage.Visibility=$bar.Visibility='Collapsed';$image.Visibility='Visible';$script:lastImage=''
 }
 $timer.Interval=[TimeSpan]::FromMilliseconds(80);$script:mode=$mode;$script:menuShowing=$false;$script:hoverUntil=[DateTime]::MinValue
}
$timer=[Windows.Threading.DispatcherTimer]::new([Windows.Threading.DispatcherPriority]::Normal);$timer.Interval=[TimeSpan]::FromMilliseconds(80);$script:lastTick=[DateTime]::UtcNow;$script:ticks=0
$timer.Add_Tick({
 try{
  $now=[DateTime]::UtcNow;$dt=[Math]::Min(0.035,($now-$script:lastTick).TotalSeconds);$script:lastTick=$now
  if(!$motion.Dragging -and ($now-$script:lastRead).TotalMilliseconds -ge 80){
   $script:lastRead=$now
   try{$raw=$stateReader.Text;if($raw -and $raw -ne $script:lastStateText){$next=$raw|ConvertFrom-Json;if($next){$wasGravity=$script:state.gravity;$script:state=$next;$script:lastStateText=$raw;$motion.Gravity=($next.gravity -ne $false);if($wasGravity -ne $false -and $next.gravity -eq $false){$motion.Vy=0}}}}catch{}
   $s=$script:state;Apply-Theme $s.theme;Apply-Language $s.language $s.languageRevision;Sync-Weapons $s.weapons
   if($s.quit -or ($s.heartbeat -and ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$s.heartbeat) -gt 45000)){$window.Close();return}
   if($s.enabled -eq $false){$window.Hide()}elseif(!$window.IsVisible){$window.Show()}
   for($i=$script:commands.Count-1;$i -ge 0;$i--){if($script:commands[$i].id -le $s.inputAck){$script:commands.RemoveAt($i)}}
   $desired=if($s.mode -eq 'arena'){'arena'}else{'pet'};Change-Mode $desired
   $name.Text=if($s.name){$s.name}else{L 'pet.001'};$gravity.BorderBrush=if($s.gravity -ne $false){(Theme-Brush 'accent')}else{[Windows.Media.Brushes]::Transparent}
   if($script:mode -eq 'pet' -and $s.image -and $s.image -ne $script:lastImage){
    $bytes=[Convert]::FromBase64String($s.image.Substring(22));Set-Bitmap $image $bytes
    $sha=[Security.Cryptography.SHA256]::Create();try{$script:imageHash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};$script:lastImage=$s.image
   }
   if($s.hitMessage -and $s.hitUntil -gt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()){$text.Text=$s.hitMessage;$script:messageUntil=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$s.hitUntil).UtcDateTime}
   elseif($s.message -and $s.message -ne $script:lastMessage){$text.Text=$s.message;$script:lastMessage=$s.message;$script:messageUntil=$now.AddSeconds(7)}
   foreach($sound in $s.sounds){if($sound.id -le $script:lastSound){continue};$script:lastSound=$sound.id;if($sound.file -notmatch '^sound-[A-Za-z0-9_-]+\.(wav|mp3|ogg|webm|mp4|aac|flac)$'){continue}
    if($script:soundPlayers.Count -ge 8){$script:soundPlayers[0].Close();$script:soundPlayers.RemoveAt(0)}
    $player=New-Object Windows.Media.MediaPlayer;$player.Volume=$sound.volume;if($sound.pitch){$player.SpeedRatio=[Math]::Max(0.25,[Math]::Min(4,$sound.pitch))};$player.Open([Uri](Join-Path (Split-Path $StatePath) $sound.file));$player.Play();$script:soundPlayers.Add($player)|Out-Null
   }
  }
  if(!$window.IsVisible){Write-Status;return}
  if($script:mode -eq 'arena'){

   if($script:highlightWeapon -ne $script:state.weapon){$script:highlightWeapon=$script:state.weapon;foreach($key in $weaponButtons.Keys){$weaponButtons[$key].BorderBrush=if($key -eq $script:state.weapon){(Theme-Brush 'accent')}else{[Windows.Media.Brushes]::Transparent}}}
   $current=$script:state.weapons|Where-Object {$_.id -eq $script:state.weapon}|Select-Object -First 1
   $hud.Text=L 'native.hud' @{name=$name.Text;weapon=$current.name;damage=$script:state.damage;error=$script:state.damageError}
  }else{
   if(($image.IsMouseOver -and $petShape.Contains([Windows.Input.Mouse]::GetPosition($image))) -or $hover.IsMouseOver){$script:hoverUntil=$now.AddMilliseconds(450)}
   Show-Hover (!$motion.Dragging -and $script:hoverUntil -gt $now)
   $bubble.Visibility=if($hover.Visibility -ne 'Visible' -and $script:state.speech -ne $false -and $script:messageUntil -gt $now){'Visible'}else{'Collapsed'}
   $area=Monitor-Bounds $true
   [Windows.Controls.Canvas]::SetLeft($hover,[Math]::Max(($area.left-$window.Left+8),[Math]::Min(37,($area.right-$window.Left-$hover.Width-8))))
   [Windows.Controls.Canvas]::SetTop($hover,[Math]::Max(0,($area.top-$window.Top+8)))

  }
  $script:ticks++;if($script:ticks % $(if($script:mode -eq 'arena'){3}else{2}) -eq 0){Write-Status}
 }catch{[Console]::Error.WriteLine($_.Exception.ToString());$window.Close()}
})
$window.Add_Closed({$timer.Stop();$motion.Dispose();$stateReader.Dispose();$frameStream.Dispose();foreach($player in $script:soundPlayers){$player.Close()};$app.Shutdown()})
Apply-Theme $initial.theme
$timer.Start();$app.Run($window)|Out-Null
