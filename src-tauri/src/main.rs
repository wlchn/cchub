// Windows 的 release 构建不要附带控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cchub_lib::run()
}
