// Both UseWPF and UseWindowsForms are on, and their implicit usings each bring
// in an `Application` type. WinForms is present only for NotifyIcon and Screen,
// so WPF wins every ambiguous name here.
global using Application = System.Windows.Application;
global using MessageBox = System.Windows.MessageBox;
