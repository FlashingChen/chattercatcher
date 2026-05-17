import crypto from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { loadSecrets, saveSecrets } from "../config/store.js";
import type { AppConfig } from "../config/schema.js";
import { CronJobRepository } from "../cron/jobs.js";
import { openDatabase } from "../db/database.js";
import { FileJobRepository } from "../files/jobs.js";
import { EpisodeRepository } from "../episodes/repository.js";
import { getGatewayStatus } from "../gateway/index.js";
import { MessageRepository } from "../messages/repository.js";
import { processMessagesNow } from "../rag/manual-index.js";
import { QaLogRepository } from "../rag/qa-logs.js";

function buildHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>ChatterCatcher</title>
  <style>
    :root {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121a;
      --bg-tertiary: #1a1a28;
      --glass-bg: rgba(255,255,255,0.05);
      --glass-border: rgba(255,255,255,0.1);
      --glass-border-hover: rgba(255,255,255,0.2);
      --glass-shadow: 0 8px 32px rgba(0,0,0,0.3);
      --text-primary: #f0f0f5;
      --text-secondary: #a0a0b0;
      --text-muted: #6e6e80;
      --accent: #64d2ff;
      --accent-hover: #7dd8ff;
      --success: #30d158;
      --warning: #ff9f0a;
      --danger: #ff453a;
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 24px;
      --space-xs: 4px;
      --space-sm: 8px;
      --space-md: 16px;
      --space-lg: 24px;
      --space-xl: 32px;
      --space-2xl: 48px;
      --font-sans: -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
      --font-mono: "SF Mono","Menlo","Consolas",monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      min-height: 100vh;
    }
    .glass {
      background: var(--glass-bg);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--glass-shadow);
      transition: all 0.3s ease;
    }
    .glass:hover { border-color: var(--glass-border-hover); box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
    .gradient-bg {
      background: linear-gradient(135deg,#0a0a0f 0%,#12121a 50%,#1a1a28 100%);
      min-height: 100vh;
    }
    .sidebar {
      position: fixed; left: 0; top: 0; width: 260px; height: 100vh;
      padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md); z-index: 100;
      background: linear-gradient(180deg,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0.02) 100%);
      backdrop-filter: blur(40px) saturate(200%);
      -webkit-backdrop-filter: blur(40px) saturate(200%);
      border-right: 1px solid var(--glass-border);
    }
    .sidebar-logo {
      display: flex; align-items: center; gap: var(--space-sm);
      padding: var(--space-md); font-size: 20px; font-weight: 700;
      color: var(--text-primary); margin-bottom: var(--space-md);
    }
    .logo-icon {
      width: 36px; height: 36px;
      background: linear-gradient(135deg,var(--accent),#5e60ce);
      border-radius: var(--radius-md);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 16px rgba(100,210,255,0.3);
    }
    .sidebar-nav { display: flex; flex-direction: column; gap: var(--space-xs); }
    .nav-item {
      display: flex; align-items: center; gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md);
      color: var(--text-secondary); text-decoration: none; cursor: pointer;
      transition: all 0.2s ease; border: none; background: none;
      font-size: 14px; font-family: inherit; width: 100%; text-align: left;
    }
    .nav-item:hover { background: rgba(255,255,255,0.06); color: var(--text-primary); }
    .nav-item.active {
      background: rgba(100,210,255,0.15); color: var(--accent);
      box-shadow: 0 0 20px rgba(100,210,255,0.1);
    }
    .nav-icon { width: 20px; height: 20px; flex-shrink: 0; }
    .main-content { margin-left: 260px; min-height: 100vh; padding: var(--space-xl); }
    .page-header { margin-bottom: var(--space-xl); }
    .page-title {
      font-size: 36px; font-weight: 700; letter-spacing: -0.03em;
      margin-bottom: var(--space-sm);
      background: linear-gradient(135deg,var(--text-primary),var(--accent));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .page-subtitle { color: var(--text-secondary); font-size: 15px; }
    .metrics-grid {
      display: grid; grid-template-columns: repeat(auto-fit,minmax(200px,1fr));
      gap: var(--space-md); margin-bottom: var(--space-xl);
    }
    .metric-card {
      padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-sm);
      position: relative; overflow: hidden;
    }
    .metric-card::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg,var(--accent),transparent); opacity: 0.5;
    }
    .metric-value { font-size: 40px; font-weight: 700; color: var(--text-primary); line-height: 1; font-variant-numeric: tabular-nums; }
    .metric-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
    .metric-note { font-size: 13px; color: var(--text-secondary); margin-top: var(--space-xs); }
    .content-grid { display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-lg); }
    .content-panel { padding: var(--space-lg); }
    .panel-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: var(--space-lg); padding-bottom: var(--space-md);
      border-bottom: 1px solid var(--glass-border);
    }
    .panel-title { font-size: 18px; font-weight: 600; }
    .message-list { display: flex; flex-direction: column; gap: var(--space-sm); }
    .message-card {
      padding: var(--space-md); border-radius: var(--radius-md);
      background: rgba(255,255,255,0.03); border: 1px solid transparent;
      transition: all 0.25s ease; cursor: pointer;
    }
    .message-card:hover { background: rgba(255,255,255,0.06); border-color: var(--glass-border); transform: translateX(4px); }
    .message-meta {
      display: flex; align-items: center; gap: var(--space-md);
      color: var(--text-muted); font-size: 12px; margin-bottom: var(--space-xs); flex-wrap: wrap;
    }
    .message-text { color: var(--text-secondary); font-size: 14px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .status-dot.online { background: var(--success); box-shadow: 0 0 8px var(--success); }
    .status-dot.offline { background: var(--danger); }
    .status-dot.warning { background: var(--warning); box-shadow: 0 0 8px var(--warning); }
    .status-dot.pending { background: var(--text-muted); }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: var(--space-sm);
      padding: 10px var(--space-md); border-radius: var(--radius-md);
      border: 1px solid var(--glass-border); background: var(--glass-bg);
      color: var(--text-primary); font-family: inherit; font-size: 14px;
      cursor: pointer; transition: all 0.2s ease; text-decoration: none;
    }
    .btn:hover { background: rgba(255,255,255,0.1); border-color: var(--glass-border-hover); transform: translateY(-1px); }
    .btn-primary {
      background: linear-gradient(135deg,var(--accent),#5e60ce); color: white; border: none;
      font-weight: 600; box-shadow: 0 4px 16px rgba(100,210,255,0.3);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg,var(--accent-hover),#6b6dd8);
      box-shadow: 0 6px 20px rgba(100,210,255,0.4); transform: translateY(-1px);
    }
    .btn-danger { background: rgba(255,69,58,0.15); color: var(--danger); border-color: rgba(255,69,58,0.3); }
    .btn-danger:hover { background: rgba(255,69,58,0.25); }
    .btn-sm { padding: 6px var(--space-sm); font-size: 13px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .tag {
      display: inline-flex; align-items: center; padding: 2px 10px;
      border-radius: 20px; font-size: 12px; font-weight: 500;
      background: rgba(255,255,255,0.06); color: var(--text-secondary);
    }
    .tag-success { background: rgba(48,209,88,0.15); color: var(--success); }
    .tag-warning { background: rgba(255,159,10,0.15); color: var(--warning); }
    .tag-error { background: rgba(255,69,58,0.15); color: var(--danger); }
    .tag-info { background: rgba(100,210,255,0.15); color: var(--accent); }
    .empty-state { text-align: center; padding: var(--space-2xl); color: var(--text-muted); }
    .empty-state svg { width: 48px; height: 48px; margin: 0 auto var(--space-md); opacity: 0.3; }
    .skeleton {
      background: linear-gradient(90deg,rgba(255,255,255,0.03) 25%,rgba(255,255,255,0.08) 50%,rgba(255,255,255,0.03) 75%);
      background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: var(--radius-sm);
    }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .view { display: none; animation: fadeIn 0.35s ease; }
    .view.active { display: block; }
    .search-box { position: relative; width: 100%; max-width: 400px; }
    .search-box input {
      width: 100%; padding: var(--space-sm) var(--space-md) var(--space-sm) 40px;
      border-radius: var(--radius-md); border: 1px solid var(--glass-border);
      background: var(--glass-bg); color: var(--text-primary); font-family: inherit;
      font-size: 14px; outline: none; transition: all 0.2s ease;
    }
    .search-box input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(100,210,255,0.1); }
    .search-box .search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th {
      text-align: left; padding: var(--space-sm) var(--space-md); color: var(--text-muted);
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
      border-bottom: 1px solid var(--glass-border);
    }
    .data-table td { padding: var(--space-sm) var(--space-md); color: var(--text-secondary); font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.03); vertical-align: top; }
    .data-table tr:hover td { background: rgba(255,255,255,0.02); }
    .data-table tr:last-child td { border-bottom: none; }
    .truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .truncate-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .truncate-3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .flex { display: flex; } .flex-col { flex-direction: column; }
    .items-center { align-items: center; } .justify-between { justify-content: space-between; }
    .gap-sm { gap: var(--space-sm); } .gap-md { gap: var(--space-md); }
    .mt-md { margin-top: var(--space-md); } .mt-lg { margin-top: var(--space-lg); }
    .mb-md { margin-bottom: var(--space-md); }
    .toast {
      padding: var(--space-md) var(--space-lg); border-radius: var(--radius-md);
      background: var(--glass-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border);
      box-shadow: 0 8px 32px rgba(0,0,0,0.4); color: var(--text-primary); font-size: 14px;
      max-width: 400px; animation: slideIn 0.3s ease;
      display: flex; align-items: center; gap: var(--space-sm);
    }
    .toast-success { border-color: rgba(48,209,88,0.3); background: rgba(48,209,88,0.1); }
    .toast-error { border-color: rgba(255,69,58,0.3); background: rgba(255,69,58,0.1); }
    .toast-warning { border-color: rgba(255,159,10,0.3); background: rgba(255,159,10,0.1); }
    .episode-card {
      padding: var(--space-md); border-radius: var(--radius-md);
      background: rgba(255,255,255,0.03); border: 1px solid transparent; transition: all 0.25s ease;
    }
    .episode-card:hover { background: rgba(255,255,255,0.06); border-color: var(--glass-border); }
    .qa-card {
      padding: var(--space-md); border-radius: var(--radius-md);
      background: rgba(255,255,255,0.03); border-left: 3px solid var(--accent); margin-bottom: var(--space-sm);
    }
    .qa-question { font-weight: 600; color: var(--text-primary); margin-bottom: var(--space-xs); font-size: 14px; }
    .qa-answer { color: var(--text-secondary); font-size: 14px; line-height: 1.6; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-lg); }
    .section-title { font-size: 24px; font-weight: 700; }
    .tabs {
      display: flex; gap: var(--space-xs); padding: 4px;
      background: rgba(255,255,255,0.03); border-radius: var(--radius-md); border: 1px solid var(--glass-border);
    }
    .tab { padding: 8px 16px; border-radius: var(--radius-sm); border: none; background: none; color: var(--text-secondary); font-family: inherit; font-size: 14px; cursor: pointer; transition: all 0.2s ease; }
    .tab:hover { color: var(--text-primary); }
    .tab.active { background: rgba(255,255,255,0.08); color: var(--text-primary); font-weight: 500; }
    .file-card {
      padding: var(--space-md); border-radius: var(--radius-md);
      background: rgba(255,255,255,0.03); border: 1px solid transparent; transition: all 0.25s ease; cursor: pointer;
    }
    .file-card:hover { background: rgba(255,255,255,0.06); border-color: var(--glass-border); }
    .file-icon {
      width: 40px; height: 40px; border-radius: var(--radius-sm);
      background: linear-gradient(135deg,var(--accent),#5e60ce);
      display: flex; align-items: center; justify-content: center; margin-bottom: var(--space-sm);
    }
    .timeline { position: relative; padding-left: 28px; }
    .timeline::before { content: ''; position: absolute; left: 8px; top: 0; bottom: 0; width: 2px; background: linear-gradient(180deg,var(--accent),transparent); opacity: 0.3; }
    .timeline-item { position: relative; padding-bottom: var(--space-lg); }
    .timeline-item::before { content: ''; position: absolute; left: -24px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg-primary); box-shadow: 0 0 0 2px var(--accent); }
    .timeline-date { font-size: 12px; color: var(--text-muted); margin-bottom: var(--space-xs); }
    .timeline-content { color: var(--text-secondary); font-size: 14px; }
    .status-bar { display: flex; align-items: center; gap: var(--space-md); padding: var(--space-md); margin-bottom: var(--space-lg); }
    .status-item { display: flex; align-items: center; gap: var(--space-sm); }
    .status-label { font-size: 13px; color: var(--text-muted); }
    .status-value { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .grid-2 { display: grid; grid-template-columns: repeat(2,1fr); gap: var(--space-md); }
    .grid-3 { display: grid; grid-template-columns: repeat(3,1fr); gap: var(--space-md); }
    .settings-group { padding: var(--space-lg); margin-bottom: var(--space-lg); }
    .settings-item { display: flex; justify-content: space-between; align-items: center; padding: var(--space-md) 0; border-bottom: 1px solid var(--glass-border); }
    .settings-item:last-child { border-bottom: none; }
    .settings-label { font-size: 14px; font-weight: 500; color: var(--text-primary); }
    .settings-value { font-size: 14px; color: var(--text-secondary); font-family: var(--font-mono); }
    .settings-desc { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    .mobile-nav {
      display: none; position: fixed; bottom: 0; left: 0; right: 0;
      padding: var(--space-sm); z-index: 100; flex-direction: row; justify-content: space-around;
      border-top: 1px solid var(--glass-border);
      background: linear-gradient(180deg,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0.02) 100%);
      backdrop-filter: blur(40px) saturate(200%);
    }
    .mobile-nav-item { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: var(--space-xs); color: var(--text-secondary); text-decoration: none; cursor: pointer; border: none; background: none; font-size: 10px; font-family: inherit; }
    .mobile-nav-item.active { color: var(--accent); }
    .pulse { animation: pulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }
    @media (max-width: 1024px) {
      .sidebar { width: 72px; padding: var(--space-sm); }
      .sidebar-logo span, .nav-item span { display: none; }
      .nav-item { justify-content: center; padding: var(--space-sm); }
      .main-content { margin-left: 72px; padding: var(--space-lg); }
      .content-grid { grid-template-columns: 1fr; }
      .metrics-grid { grid-template-columns: repeat(2,1fr); }
    }
    @media (max-width: 768px) {
      .sidebar { display: none; }
      .mobile-nav { display: flex; }
      .main-content { margin-left: 0; margin-bottom: 80px; padding: var(--space-md); }
      .page-title { font-size: 28px; }
      .metrics-grid { grid-template-columns: repeat(2,1fr); }
      .grid-2, .grid-3 { grid-template-columns: 1fr; }
      .section-header { flex-direction: column; align-items: flex-start; gap: var(--space-sm); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
    }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
    .highlight-text { background: rgba(100,210,255,0.15); padding: 0 4px; border-radius: 3px; color: var(--accent); }
  </style>
</head>
<body class="gradient-bg">
  <aside class="sidebar">
    <div class="sidebar-logo">
      <div class="logo-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <span>ChatterCatcher</span>
    </div>
    <nav class="sidebar-nav">
      <button class="nav-item active" data-view="overview">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span>概览</span>
      </button>
      <button class="nav-item" data-view="messages">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>消息</span>
      </button>
      <button class="nav-item" data-view="episodes">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <span>会话记忆</span>
      </button>
      <button class="nav-item" data-view="files">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>文件库</span>
      </button>
      <button class="nav-item" data-view="tasks">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span>任务</span>
      </button>
      <button class="nav-item" data-view="qa-logs">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>问答日志</span>
      </button>
      <button class="nav-item" data-view="settings">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span>设置</span>
      </button>
    </nav>
    <div style="margin-top: auto; padding: var(--space-md);">
      <div style="display: flex; align-items: center; gap: var(--space-sm); font-size: 12px; color: var(--text-muted);">
        <span class="status-dot online" id="gateway-indicator"></span>
        <span id="gateway-status-text">Gateway 运行中</span>
      </div>
      <div style="font-size: 11px; color: var(--text-muted); margin-top: var(--space-xs); opacity: 0.7;" id="version-text">v0.0.0</div>
    </div>
  </aside>

  <nav class="mobile-nav glass">
    <button class="mobile-nav-item active" data-view="overview">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      <span>概览</span>
    </button>
    <button class="mobile-nav-item" data-view="messages">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span>消息</span>
    </button>
    <button class="mobile-nav-item" data-view="files">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span>文件</span>
    </button>
    <button class="mobile-nav-item" data-view="tasks">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      <span>任务</span>
    </button>
    <button class="mobile-nav-item" data-view="settings">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      <span>设置</span>
    </button>
  </nav>

  <main class="main-content">
    <div class="view active" id="view-overview">
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">本地优先的家庭群知识库 · 问答必须先检索 RAG 证据，不堆叠全量上下文</p>
      </div>
      <div class="metrics-grid" id="metrics"></div>
      <div class="content-grid">
        <div>
          <div class="content-panel glass">
            <div class="panel-header">
              <h2 class="panel-title">最近消息</h2>
              <button class="btn btn-sm" onclick="navigateTo('messages')">查看全部</button>
            </div>
            <div id="recent-messages"></div>
          </div>
          <div class="content-panel glass mt-lg">
            <div class="panel-header">
              <h2 class="panel-title">会话记忆</h2>
              <button class="btn btn-sm" onclick="navigateTo('episodes')">查看全部</button>
            </div>
            <div id="recent-episodes"></div>
          </div>
        </div>
        <div>
          <div class="content-panel glass">
            <div class="panel-header"><h2 class="panel-title">系统状态</h2></div>
            <div id="system-status"></div>
          </div>
          <div class="content-panel glass mt-lg">
            <div class="panel-header"><h2 class="panel-title">快捷操作</h2></div>
            <div style="display: flex; flex-direction: column; gap: var(--space-sm);">
              <button class="btn btn-primary" id="btn-process-messages" onclick="processNow()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                立即处理消息
              </button>
              <button class="btn" onclick="navigateTo('settings')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                系统设置
              </button>
            </div>
          </div>
          <div class="content-panel glass mt-lg">
            <div class="panel-header"><h2 class="panel-title">RAG 检索</h2></div>
            <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.8;">
              <div style="display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-sm);"><span class="tag tag-success">FTS5</span><span>关键词检索</span></div>
              <div style="display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-sm);"><span class="tag tag-info">向量</span><span>语义检索</span></div>
              <div style="display: flex; align-items: center; gap: var(--space-sm);"><span class="tag tag-success">混合</span><span>Hybrid RAG</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="view" id="view-messages">
      <div class="section-header">
        <div><h1 class="section-title">消息</h1><p class="page-subtitle">群聊消息历史</p></div>
        <div class="search-box">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="message-search" placeholder="搜索消息..." oninput="filterMessages()" />
        </div>
      </div>
      <div class="content-panel glass"><div id="messages-list"></div></div>
    </div>

    <div class="view" id="view-episodes">
      <div class="section-header"><div><h1 class="section-title">会话记忆</h1><p class="page-subtitle">自动聚合的聊天片段</p></div></div>
      <div class="content-panel glass"><div id="episodes-list"></div></div>
    </div>

    <div class="view" id="view-files">
      <div class="section-header"><div><h1 class="section-title">文件库</h1><p class="page-subtitle">已导入的文件知识源</p></div></div>
      <div id="files-list"></div>
    </div>

    <div class="view" id="view-tasks">
      <div class="section-header"><div><h1 class="section-title">任务</h1><p class="page-subtitle">文件解析与定时任务</p></div></div>
      <div class="tabs" style="margin-bottom: var(--space-lg);">
        <button class="tab active" data-tab="file-jobs" onclick="switchTab('file-jobs')">文件解析</button>
        <button class="tab" data-tab="cron-jobs" onclick="switchTab('cron-jobs')">定时任务</button>
      </div>
      <div class="content-panel glass" id="tab-file-jobs"><div id="file-jobs-list"></div></div>
      <div class="content-panel glass" id="tab-cron-jobs" style="display: none;"><div id="cron-jobs-list"></div></div>
    </div>

    <div class="view" id="view-qa-logs">
      <div class="section-header"><div><h1 class="section-title">问答日志</h1><p class="page-subtitle">问答历史记录</p></div></div>
      <div class="content-panel glass"><div id="qa-logs-list"></div></div>
    </div>

    <div class="view" id="view-settings">
      <div class="section-header"><div><h1 class="section-title">设置</h1><p class="page-subtitle">系统配置与操作</p></div></div>
      <div class="settings-group glass" id="settings-config"></div>
      <div class="settings-group glass">
        <h3 style="font-size: 16px; font-weight: 600; margin-bottom: var(--space-md);">操作</h3>
        <div style="display: flex; flex-direction: column; gap: var(--space-sm);">
          <button class="btn btn-primary" onclick="processNow()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            立即处理消息索引
          </button>
          <div style="font-size: 12px; color: var(--text-muted); padding: var(--space-sm); background: rgba(255,255,255,0.03); border-radius: var(--radius-sm);">
            运行 CLI 命令进行更多操作：
            <div style="font-family: var(--font-mono); margin-top: var(--space-xs); line-height: 1.8;">
              chattercatcher settings<br/>
              chattercatcher doctor<br/>
              chattercatcher index rebuild<br/>
              chattercatcher files add &lt;path...&gt;<br/>
              chattercatcher export
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <div id="toast-container" style="position: fixed; top: 24px; right: 24px; z-index: 1001; display: flex; flex-direction: column; gap: 12px;"></div>

  <script>
    let currentView = "overview";
    let allMessages = [];
    let allEpisodes = [];
    let allFiles = [];
    let allFileJobs = [];
    let allCronJobs = [];
    let allQaLogs = [];
    let statusData = null;

    function fmt(value) { return value == null || value === "" ? "-" : String(value); }
    function escapeHtml(value) {
      return fmt(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    }
    function isOpaqueId(value) { return /^(ou|oc|om|cli|on|un|uid)_?[a-z0-9]+/i.test(fmt(value)); }
    function formatDateTime(value) {
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) return fmt(value);
      var pad = function(n) { return String(n).padStart(2, "0"); };
      return date.getFullYear() + "/" + pad(date.getMonth()+1) + "/" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
    }
    function displaySender(value) { return isOpaqueId(value) ? "群成员" : fmt(value); }
    function displayChatName(value, platform) { return !isOpaqueId(value) ? fmt(value) : (platform === "feishu" ? "飞书群聊" : "群聊"); }

    function showToast(message, type) {
      type = type || "info";
      var container = document.getElementById("toast-container");
      var toast = document.createElement("div");
      toast.className = "toast toast-" + type;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(function() {
        toast.style.opacity = "0"; toast.style.transform = "translateX(10px)";
        setTimeout(function() { toast.remove(); }, 300);
      }, 3000);
    }

    function navigateTo(view) {
      document.querySelectorAll(".view").forEach(function(el) { el.classList.remove("active"); });
      document.querySelectorAll(".nav-item, .mobile-nav-item").forEach(function(el) { el.classList.remove("active"); });
      document.getElementById("view-" + view).classList.add("active");
      document.querySelectorAll('[data-view="' + view + '"]').forEach(function(el) { el.classList.add("active"); });
      currentView = view;
      window.scrollTo(0, 0);
      if (view === "messages") renderMessagesView();
      if (view === "episodes") renderEpisodesView();
      if (view === "files") renderFilesView();
      if (view === "tasks") renderTasksView();
      if (view === "qa-logs") renderQaLogsView();
    }

    document.querySelectorAll(".nav-item, .mobile-nav-item").forEach(function(el) {
      el.addEventListener("click", function() { navigateTo(el.dataset.view); });
    });

    function switchTab(tab) {
      document.querySelectorAll(".tab").forEach(function(el) { el.classList.remove("active"); });
      document.querySelector('[data-tab="' + tab + '"]').classList.add("active");
      document.getElementById("tab-file-jobs").style.display = tab === "file-jobs" ? "block" : "none";
      document.getElementById("tab-cron-jobs").style.display = tab === "cron-jobs" ? "block" : "none";
      if (tab === "file-jobs") renderFileJobs();
      if (tab === "cron-jobs") renderCronJobs();
    }

    async function fetchJson(path) {
      var response = await fetch(path);
      if (!response.ok) {
        var body = await response.text();
        throw new Error(path + " " + response.status + " " + body);
      }
      return response.json();
    }

    async function postJson(path, options) {
      var response = await fetch(path, Object.assign({ method: "POST" }, options || {}));
      var result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || result.reason || "请求失败");
      }
      return result;
    }

    async function deleteJson(path) {
      var response = await fetch(path, { method: "DELETE" });
      var result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || result.reason || "请求失败");
      }
      return result;
    }

    function renderMetrics(status) {
      var gatewayClass = status.gateway.configured ? "status-dot online" : "status-dot offline";
      var gatewayText = status.gateway.connection === "running" ? "运行中" : (!status.gateway.configured ? "未配置" : "待启动");
      var metricsHtml = [
        ["Gateway", gatewayText, "飞书长连接", gatewayClass],
        ["版本", status.version || "unknown", "当前运行版本", ""],
        ["群聊", status.data.chats, "本地群聊数", ""],
        ["消息", status.data.messages, "已入库消息", ""],
        ["会话记忆", status.data.episodes, "已生成摘要", ""],
        ["文件", status.data.files, "文件知识源", ""],
        ["问答", status.data.qaLogs, "问答记录", ""],
        ["任务", status.data.cronJobs, "定时任务", ""]
      ].map(function(item) {
        var label = item[0], value = item[1], note = item[2], dotClass = item[3];
        return '<div class="metric-card glass"><div class="metric-label">' + escapeHtml(label) + '</div>' +
          '<div class="metric-value">' + (dotClass ? '<span class="' + dotClass + '" style="margin-right:8px;"></span>' : '') + escapeHtml(value) + '</div>' +
          '<div class="metric-note">' + escapeHtml(note) + '</div></div>';
      }).join("");
      document.getElementById("metrics").innerHTML = metricsHtml;
      document.getElementById("gateway-indicator").className = gatewayClass;
      document.getElementById("gateway-status-text").textContent = "Gateway " + gatewayText;
      document.getElementById("version-text").textContent = "v" + (status.version || "unknown");
    }

    function renderSystemStatus(status) {
      var gateway = status.gateway;
      var html = '<div style="display:flex;flex-direction:column;gap:var(--space-md);">';
      html += '<div class="settings-item"><div><div class="settings-label">Gateway</div></div><div class="settings-value">' + (gateway.connection === "running" ? '<span class="tag tag-success">运行中</span>' : '<span class="tag tag-warning">未运行</span>') + '</div></div>';
      html += '<div class="settings-item"><div><div class="settings-label">Web UI</div></div><div class="settings-value">' + escapeHtml((status.web && status.web.host ? status.web.host : "127.0.0.1") + ":" + (status.web && status.web.port ? status.web.port : "3878")) + '</div></div>';
      html += '<div class="settings-item"><div><div class="settings-label">RAG 模式</div></div><div class="settings-value"><span class="tag tag-success">强制检索</span></div></div>';
      html += '<div class="settings-item"><div><div class="settings-label">关键词检索</div></div><div class="settings-value">SQLite FTS5</div></div>';
      html += '<div class="settings-item"><div><div class="settings-label">向量检索</div></div><div class="settings-value">SQLite embedding</div></div>';
      html += '</div>';
      document.getElementById("system-status").innerHTML = html;
    }

    function renderRecentMessages(items) {
      var el = document.getElementById("recent-messages");
      if (!items || items.length === 0) {
        el.innerHTML = '<div class="empty-state">还没有消息。启动 Gateway 后，群聊文本会进入本地 RAG 索引。</div>';
        return;
      }
      var html = '<div class="message-list">';
      for (var i = 0; i < Math.min(items.length, 5); i++) {
        var item = items[i];
        html += '<div class="message-card"><div class="message-meta">' +
          '<span>' + escapeHtml(formatDateTime(item.sentAt)) + '</span>' +
          '<span>' + escapeHtml(displaySender(item.senderName)) + '</span>' +
          '<span>' + escapeHtml(displayChatName(item.chatName, item.platform)) + '</span>' +
          '</div><div class="message-text">' + escapeHtml(item.text) + '</div></div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }

    function renderRecentEpisodes(items) {
      var el = document.getElementById("recent-episodes");
      if (!items || items.length === 0) {
        el.innerHTML = '<div class="empty-state">还没有会话记忆。</div>';
        return;
      }
      var html = '<div class="message-list">';
      for (var i = 0; i < Math.min(items.length, 3); i++) {
        var item = items[i];
        html += '<div class="episode-card"><div class="message-meta">' +
          '<span>' + escapeHtml(formatDateTime(item.startedAt)) + " - " + escapeHtml(formatDateTime(item.endedAt)) + '</span>' +
          '<span>' + escapeHtml(item.messageCount) + ' 条消息</span>' +
          '</div><div class="message-text">' + escapeHtml(item.summary) + '</div></div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }

    function renderMessagesView() {
      var el = document.getElementById("messages-list");
      if (!allMessages || allMessages.length === 0) {
        el.innerHTML = '<div class="empty-state">还没有消息。</div>';
        return;
      }
      var searchInput = document.getElementById("message-search");
      var searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
      var filtered = searchTerm ? allMessages.filter(function(m) { return (m.text || "").toLowerCase().indexOf(searchTerm) !== -1; }) : allMessages;
      if (filtered.length === 0) {
        el.innerHTML = '<div class="empty-state">没有找到匹配的消息。</div>';
        return;
      }
      var html = '<div class="message-list">';
      for (var i = 0; i < Math.min(filtered.length, 50); i++) {
        var item = filtered[i];
        html += '<div class="message-card"><div class="message-meta">' +
          '<span>' + escapeHtml(formatDateTime(item.sentAt)) + '</span>' +
          '<span>' + escapeHtml(displaySender(item.senderName)) + '</span>' +
          '<span>' + escapeHtml(displayChatName(item.chatName, item.platform)) + '</span>' +
          '</div><div class="message-text" style="-webkit-line-clamp:4;">' + escapeHtml(item.text) + '</div></div>';
      }
      html += '</div>';
      if (filtered.length > 50) {
        html += '<div style="text-align:center;padding:var(--space-md);color:var(--text-muted);font-size:13px;">还有 ' + (filtered.length - 50) + ' 条消息...</div>';
      }
      el.innerHTML = html;
    }

    function filterMessages() { renderMessagesView(); }

    function renderEpisodesView() {
      var el = document.getElementById("episodes-list");
      if (!allEpisodes || allEpisodes.length === 0) {
        el.innerHTML = '<div class="empty-state">还没有会话记忆。</div>';
        return;
      }
      var html = '<div class="timeline">';
      for (var i = 0; i < allEpisodes.length; i++) {
        var item = allEpisodes[i];
        html += '<div class="timeline-item"><div class="timeline-date">' + escapeHtml(formatDateTime(item.startedAt)) + " - " + escapeHtml(formatDateTime(item.endedAt)) + " \u00b7 " + escapeHtml(item.messageCount) + ' \u6761\u6d88\u606f</div><div class="timeline-content">' + escapeHtml(item.summary) + '</div></div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }

    function renderFilesView() {
      var el = document.getElementById("files-list");
      if (!allFiles || allFiles.length === 0) {
        el.innerHTML = '<div class="content-panel glass"><div class="empty-state">还没有文件。运行 <code>chattercatcher files add &lt;path...&gt;</code> \u5bfc\u5165\u6587\u4ef6\u3002</div></div>';
        return;
      }
      var html = '<div class="grid-2">';
      for (var i = 0; i < allFiles.length; i++) {
        var item = allFiles[i];
        html += '<div class="file-card glass"><div class="file-icon">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          '</div><div style="font-weight:600;margin-bottom:4px;">' + escapeHtml(item.fileName) + '</div>' +
          '<div style="font-size:13px;color:var(--text-muted);margin-bottom:4px;" class="truncate">' + escapeHtml(item.storedPath) + '</div>' +
          '<div style="display:flex;gap:var(--space-sm);"><span class="tag">' + escapeHtml(item.parser || "unknown") + '</span><span class="tag">' + escapeHtml(item.characters) + ' \u5b57\u7b26</span></div></div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }

    function renderTasksView() {
      var activeTab = document.querySelector(".tab.active");
      var tab = activeTab ? activeTab.dataset.tab : "file-jobs";
      if (tab === "file-jobs") renderFileJobs();
      else renderCronJobs();
    }

    function renderFileJobs() {
      var el = document.getElementById("file-jobs-list");
      if (!allFileJobs || allFileJobs.length === 0) {
        el.innerHTML = '<div class="empty-state">还没有文件解析任务。</div>';
        return;
      }
      var html = '<table class="data-table"><thead><tr><th>文件</th><th>状态</th><th>信息</th></tr></thead><tbody>';
      for (var i = 0; i < allFileJobs.length; i++) {
        var item = allFileJobs[i];
        var tagClass = item.status === 'indexed' ? 'tag-success' : item.status === 'failed' ? 'tag-error' : 'tag-warning';
        html += '<tr><td><div style="font-weight:500;">' + escapeHtml(item.fileName) + '</div><div style="font-size:12px;color:var(--text-muted);" class="truncate">' + escapeHtml(item.storedPath || item.id) + '</div></td>' +
          '<td><span class="tag ' + tagClass + '">' + escapeHtml(item.status) + '</span></td>' +
          '<td style="font-size:13px;color:var(--text-muted);">' + escapeHtml(item.error || "") + '</td></tr>';
      }
      html += '</tbody></table>';
      el.innerHTML = html;
    }

    function renderCronJobs() {
      var el = document.getElementById("cron-jobs-list");
      if (!allCronJobs || allCronJobs.length === 0) {
        el.innerHTML = '<div class="empty-state">还没有定时任务。</div>';
        return;
      }
      var html = '<table class="data-table"><thead><tr><th>任务</th><th>状态</th><th>操作</th></tr></thead><tbody>';
      for (var i = 0; i < allCronJobs.length; i++) {
        var item = allCronJobs[i];
        var tagClass = item.status === 'active' ? 'tag-success' : 'tag-warning';
        html += '<tr><td><div style="font-weight:500;">' + escapeHtml(item.schedule) + '</div>' +
          '<div style="font-size:13px;color:var(--text-muted);" class="truncate-2">' + escapeHtml(item.prompt) + '</div>' +
          '<div style="font-size:12px;color:var(--text-muted);">\u4e0b\u6b21: ' + escapeHtml(formatDateTime(item.nextRunAt)) + '</div>' +
          (item.lastError ? '<div style="font-size:12px;color:var(--danger);margin-top:4px;">' + escapeHtml(item.lastError) + '</div>' : '') +
          '</td><td><span class="tag ' + tagClass + '">' + escapeHtml(item.status) + '</span></td><td>' +
          (item.status === "active" ? '<button class="btn btn-sm btn-danger" data-delete-cron-job="' + escapeHtml(item.id) + '">\u5220\u9664</button>' : '-') +
          '</td></tr>';
      }
      html += '</tbody></table>';
      el.innerHTML = html;
    }

    function renderQaLogsView() {
      var el = document.getElementById("qa-logs-list");
      if (!allQaLogs || allQaLogs.length === 0) {
        el.innerHTML = '<div class="empty-state">还没有问答日志。</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < allQaLogs.length; i++) {
        var item = allQaLogs[i];
        var citationCount = Array.isArray(item.citations) ? item.citations.length : 0;
        var statusClass = item.status === 'success' ? 'tag-success' : 'tag-warning';
        html += '<div class="qa-card"><div class="message-meta" style="margin-bottom:var(--space-sm);">' +
          '<span>' + escapeHtml(formatDateTime(item.createdAt)) + '</span>' +
          '<span class="tag ' + statusClass + '">' + escapeHtml(item.status) + '</span>' +
          '<span>' + citationCount + ' \u6761\u5f15\u7528</span></div>' +
          '<div class="qa-question">' + escapeHtml(item.question) + '</div>' +
          '<div class="qa-answer">' + escapeHtml(item.answer) + '</div></div>';
      }
      el.innerHTML = html;
    }

    function renderSettings(status) {
      var el = document.getElementById("settings-config");
      var html = '<h3 style="font-size:16px;font-weight:600;margin-bottom:var(--space-md);">\u7cfb\u7edf\u914d\u7f6e</h3>';
      html += '<div style="display:flex;flex-direction:column;">';
      html += '<div class="settings-item"><div><div class="settings-label">Web UI</div><div class="settings-desc">' + escapeHtml((status.web && status.web.host ? status.web.host : "127.0.0.1") + ":" + (status.web && status.web.port ? status.web.port : "3878")) + '</div></div></div>';
      html += '<div class="settings-item"><div><div class="settings-label">Gateway</div><div class="settings-desc">' + (status.gateway.configured ? "\u5df2\u914d\u7f6e" : "\u672a\u914d\u7f6e") + '</div></div></div>';
      html += '<div class="settings-item"><div><div class="settings-label">RAG \u6a21\u5f0f</div><div class="settings-desc">\u5f3a\u5236\u5148\u68c0\u7d22\u8bc1\u636e\uff0c\u7981\u6b62\u5168\u91cf\u4e0a\u4e0b\u6587\u5806\u53e0</div></div></div>';
      html += '<div class="settings-item"><div><div class="settings-label">\u6570\u636e\u76ee\u5f55</div><div class="settings-desc">SQLite + \u672c\u5730\u6587\u4ef6</div></div></div>';
      html += '</div>';
      el.innerHTML = html;
    }

    async function loadSection(path, setter) {
      try { setter(await fetchJson(path)); }
      catch (error) { console.error("\u52a0\u8f7d\u5931\u8d25:", path, error); }
    }

    async function load() {
      await loadSection("/api/status", function(data) {
        statusData = data;
        renderMetrics(data);
        renderSystemStatus(data);
        renderSettings(data);
      });
      await loadSection("/api/messages/recent?limit=50", function(data) { allMessages = data.items || []; renderRecentMessages(allMessages); });
      await loadSection("/api/episodes?limit=20", function(data) { allEpisodes = data.items || []; renderRecentEpisodes(allEpisodes); });
      await loadSection("/api/files", function(data) { allFiles = data.items || []; });
      await loadSection("/api/file-jobs", function(data) { allFileJobs = data.items || []; });
      await loadSection("/api/qa-logs?limit=20", function(data) { allQaLogs = data.items || []; });
      await loadSection("/api/cron-jobs", function(data) { allCronJobs = data.items || []; });
      if (currentView === "messages") renderMessagesView();
      if (currentView === "episodes") renderEpisodesView();
      if (currentView === "files") renderFilesView();
      if (currentView === "tasks") renderTasksView();
      if (currentView === "qa-logs") renderQaLogsView();
    }

    async function processNow() {
      var btn = document.getElementById("btn-process-messages");
      if (btn) { btn.disabled = true; }
      showToast("\u6b63\u5728\u5904\u7406\u6d88\u606f\u7d22\u5f15...", "info");
      try {
        var result = await postJson("/api/process/messages");
        if (result.status === "skipped") { showToast(result.reason, "warning"); }
        else { showToast("\u5904\u7406\u5b8c\u6210\uff1achunks=" + result.chunks + ", vectors=" + result.vectors, "success"); }
        await load();
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), "error");
      } finally {
        if (btn) { btn.disabled = false; }
      }
    }

    document.addEventListener("click", async function(event) {
      var target = event.target;
      if (!(target instanceof HTMLElement)) return;
      var id = target.dataset.deleteCronJob;
      if (!id) return;
      target.disabled = true;
      showToast("\u6b63\u5728\u5220\u9664\u5b9a\u65f6\u4efb\u52a1...", "info");
      try {
        var result = await deleteJson("/api/cron-jobs/" + encodeURIComponent(id));
        showToast(result.ok ? "\u5b9a\u65f6\u4efb\u52a1\u5df2\u5220\u9664" : (result.message || "\u5220\u9664\u5931\u8d25"), result.ok ? "success" : "error");
        await load();
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), "error");
      }
    });

    void load();
    setInterval(function() { if (document.visibilityState === "visible") void load(); }, 5000);
  </script>
</body>
</html>`;
}

export interface WebAppOptions {
  version?: string;
}

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const rawLimit = Number(value ?? fallback);
  return Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), max) : fallback;
}

function getWebActionToken(secrets: Awaited<ReturnType<typeof loadSecrets>>): string {
  return secrets.web.actionToken;
}

function getWebActionCookie(token: string): string {
  return `chattercatcher_web_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`;
}

function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const value = Array.isArray(header) ? header.join("; ") : header;
  if (!value) return {};
  const cookies: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
}

function isAuthorizedWebAction(request: { headers: Record<string, string | string[] | undefined> }, token: string): boolean {
  return parseCookies(request.headers.cookie).chattercatcher_web_token === token;
}

export function createWebApp(config: AppConfig, options: WebAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const database = openDatabase(config);
  const version = options.version ?? "unknown";
  const messages = new MessageRepository(database);
  const episodes = new EpisodeRepository(database);
  const fileJobs = new FileJobRepository(database);
  const qaLogs = new QaLogRepository(database);
  const cronJobs = new CronJobRepository(database);
  let webActionToken = "";
  const tokenReady = (async () => {
    const secrets = await loadSecrets();
    if (!secrets.web.actionToken) {
      secrets.web.actionToken = crypto.randomBytes(32).toString("hex");
      await saveSecrets(secrets);
    }
    webActionToken = getWebActionToken(secrets);
  })();

  app.addHook("onClose", async () => {
    database.close();
  });

  app.get("/api/status", async () => {
    await tokenReady;
    return {
      app: "ChatterCatcher",
      version,
      gateway: getGatewayStatus(config),
      data: {
        chats: messages.getChatCount(),
        messages: messages.getMessageCount(),
        episodes: episodes.getEpisodeCount(),
        files: messages.listFiles(1_000).length,
        qaLogs: qaLogs.getCount(),
        cronJobs: cronJobs.list(1_000).length,
      },
      rag: {
        mode: "required",
        note: "问答必须先检索证据，禁止全量上下文堆叠。",
        retrieval: {
          keyword: "SQLite FTS5",
          vector: "SQLite embedding",
          hybrid: true,
        },
      },
      web: config.web,
    };
  });

  app.get("/api/chats", async () => ({
    items: messages.listChats(),
  }));

  app.get("/api/files", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50, 200);
    return {
      items: messages.listFiles(limit),
    };
  });

  app.get("/api/file-jobs", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50, 200);
    const status = (request.query as { status?: string }).status;
    return {
      items: fileJobs.list(limit, status === "processing" || status === "indexed" || status === "failed" ? { status } : {}),
    };
  });

  app.get("/api/messages/recent", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 20, 100);
    return {
      items: messages.listRecentMessages(limit),
    };
  });

  app.get("/api/episodes", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 20, 100);
    return {
      items: episodes.listRecentEpisodes(limit),
    };
  });

  app.get("/api/qa-logs", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 20, 100);
    return {
      items: qaLogs.listRecent(limit),
    };
  });

  app.get("/api/cron-jobs", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50, 200);
    return {
      items: cronJobs.list(limit),
    };
  });

  app.delete("/api/cron-jobs/:id", async (request, reply) => {
    await tokenReady;
    if (!isAuthorizedWebAction(request, webActionToken)) {
      reply.code(403);
      return { ok: false, message: "Web 操作未授权。" };
    }

    const id = (request.params as { id: string }).id;
    const job = cronJobs.get(id);
    if (!job) {
      reply.code(404);
      return { ok: false, message: "没有找到定时任务。" };
    }

    const ok = cronJobs.deleteByChat(id, job.chatId);
    return { ok };
  });

  app.post("/api/process/messages", async (request, reply) => {
    await tokenReady;
    if (!isAuthorizedWebAction(request, webActionToken)) {
      reply.code(403);
      return { status: "failed", message: "Web 操作未授权。" };
    }

    try {
      return await processMessagesNow({
        config,
        secrets: await loadSecrets(),
        database,
        limit: 10_000,
      });
    } catch (error) {
      reply.code(500);
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  app.get("/", async (_request, reply) => {
    await tokenReady;
    reply.type("text/html; charset=utf-8");
    reply.header("set-cookie", getWebActionCookie(webActionToken));
    return buildHtml();
  });

  return app;
}

export async function startWebServer(config: AppConfig, options: WebAppOptions = {}): Promise<void> {
  const app = createWebApp(config, options);
  await app.listen({ host: config.web.host, port: config.web.port });
  const address = app.server.address();
  const url =
    typeof address === "string" ? address : `http://${config.web.host}:${address?.port ?? config.web.port}`;
  const versionText = options.version ? ` ${options.version}` : "";
  console.log(`ChatterCatcher Web UI${versionText}: ${url}`);
}
