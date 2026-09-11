mod apps;
mod catalog_source;
mod error;
mod keys;
mod mcp;
mod prefs;
mod providers;
mod registry;
mod routes;
mod skills;
mod sys;

use apps::RunningTasks;
use catalog_source::CatalogState;
use keys::KeysState;
use prefs::PrefsState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 开机自启按登录项注册（macOS Launch Agent / Windows 注册表），
    // 由设置页开关控制，默认不启用。
    let autostart =
        tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(autostart)
        .manage(RunningTasks::default())
        .manage(CatalogState::new())
        .invoke_handler(tauri::generate_handler![
            apps::detect_apps,
            apps::detect_app,
            apps::detect_environment,
            apps::check_latest_version,
            apps::run_app_task,
            prefs::get_prefs,
            prefs::set_prefs,
            catalog_source::get_catalog,
            catalog_source::test_network,
            skills::list_skills,
            skills::list_skill_sources,
            skills::install_skill,
            skills::set_skill_enabled,
            skills::uninstall_skill,
            keys::list_key_refs,
            keys::save_key,
            keys::delete_key,
            keys::reveal_key,
            keys::test_key,
            providers::list_providers,
            mcp::list_mcp_services,
            mcp::read_host_config,
            mcp::write_mcp_service,
            mcp::remove_mcp_service,
            mcp::test_mcp_service,
            routes::list_routes,
            routes::save_route,
            routes::delete_route,
            routes::switch_route,
            routes::apply_routes,
            routes::clear_route,
            routes::probe_route,
        ])
        .setup(|app| {
            // 偏好要在任何命令可用前就绪：代理快照被子进程构造读取（sys::proxy_envs），
            // 目录 TTL 也来自它。惰性建状态 + 立刻加载并注入代理。
            use tauri::Manager;
            let state = PrefsState::load(&app);
            sys::set_proxy_prefs(state.snapshot().proxy);
            app.manage(state);
            app.manage(KeysState::load(&app.handle()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 CCHub 失败");
}
