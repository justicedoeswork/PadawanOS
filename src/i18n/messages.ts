/**
 * The message dictionary (#91): every UI-chrome string Panda renders, keyed
 * `<domain>.<name>` with one entry per locale. en is the source of truth —
 * zh entries may lag (translate() falls back to en when the zh slot is
 * missing), but an entirely missing KEY is a programming error and warns in
 * the console.
 *
 * Scope (issue #91): chrome only — buttons, labels, badges, placeholders,
 * hints, notices, and error strings that reach the UI. NOT translated: agent
 * output (messages, tool results, diffs), demo replay fixtures, user input,
 * docs, and code comments (this file's zh column is the only place those
 * strings leave the components).
 *
 * Interpolation: `{name}` placeholders, filled by t(key, { name: value }).
 */
export const messages = {
  // ---- shell / app frame ----
  'app.closeNav': { en: 'Close navigation', zh: '关闭导航' },
  'app.openNav': { en: 'Open navigation', zh: '打开导航' },
  'app.back': { en: 'Back', zh: '返回' },
  'app.backTooltip': { en: 'Back to the session view', zh: '回到会话界面' },
  'app.liveSessionTitle': { en: 'Live session', zh: 'Live 会话' },
  'app.demoHeaderTitle': { en: 'Refactor auth validation', zh: '重构 auth 校验' },

  // ---- shared connection states (StatusDot labels etc.) ----
  'conn.connected': { en: 'Connected', zh: '已连接' },
  'conn.error': { en: 'Connection error', zh: '连接错误' },
  'conn.authRequired': { en: 'Sign-in required', zh: '需要登录' },
  'conn.disconnected': { en: 'Not connected', zh: '未连接' },
  'conn.running': { en: 'Running', zh: '运行中' },

  // ---- StatusBar ----
  'status.connecting': { en: 'Connecting…', zh: '连接中…' },
  'status.switching': { en: 'Switching session…', zh: '切换会话中…' },
  'status.authenticated': { en: 'Authenticated', zh: '已认证' },
  'status.authenticatedVia': { en: 'Authenticated via “{name}”', zh: '已通过「{name}」认证' },
  'status.authenticate': { en: 'Authenticate', zh: '认证' },
  'status.authenticateVia': { en: 'Authenticate via “{name}”', zh: '通过「{name}」认证' },
  'status.awaitingApproval': { en: 'Awaiting your approval', zh: '等待你的批准' },
  'status.working': { en: 'Working…', zh: '工作中…' },
  'status.ready': { en: 'Ready', zh: '就绪' },

  // ---- EmptyState (first-run onboarding, #200) ----
  'empty.title': { en: 'Connect your agent', zh: '把你的 agent 连上来' },
  'empty.lead': {
    en: 'Panda is a pure protocol client: implement ACP in your agent and this message stream is its UI. Watch the scripted demo first, or connect your own agent below.',
    zh: 'Panda 是纯协议客户端:你的 agent 说 ACP,这条消息流就是它的界面。可以先看一段 demo,或按下面两步连上你自己的 agent。',
  },
  'empty.watchDemo': { en: 'Watch a demo', zh: '看一段 demo' },
  'empty.connectHeading': { en: 'Connect your own agent', zh: '连你自己的 agent' },
  'empty.desktopKicker': { en: 'Desktop · direct stdio', zh: '桌面版 · stdio 直连' },
  'empty.desktopBody': {
    en: 'Settings → Agent profiles → New (stdio), then fill in your agent’s start command. Ten-minute walkthrough from scratch:',
    zh: '设置 → Agent profiles → 新建(stdio),填入你 agent 的启动命令。从零接入的十分钟走读:',
  },
  'empty.quickstartLink': { en: 'Agent quickstart', zh: '接入快速上手' },
  'empty.quickstartUrl': {
    en: 'https://github.com/lukaisluka/Panda/blob/main/docs/agent-quickstart.en.md',
    zh: 'https://github.com/lukaisluka/Panda/blob/main/docs/agent-quickstart.md',
  },
  'empty.webKicker': { en: 'Web · WebSocket endpoint', zh: '网页版 · WebSocket 端点' },
  'empty.webBody': {
    en: 'Point the web app at any ACP-over-WebSocket endpoint. Recipe for bridging a stdio agent to WebSocket:',
    zh: '网页版连接任一 ACP-over-WebSocket 端点。把 stdio agent 桥接为 WebSocket 的配方:',
  },
  'empty.bridgeLink': { en: 'Bridge guide', zh: '桥接指南' },
  'empty.bridgeUrl': {
    en: 'https://github.com/lukaisluka/Panda/blob/main/docs/acp-stdio-to-websocket.en.md',
    zh: 'https://github.com/lukaisluka/Panda/blob/main/docs/acp-stdio-to-websocket.md',
  },
  'empty.existingToggle': {
    en: 'Using an existing agent? (Claude Code, Gemini CLI, …)',
    zh: '用现成 agent?(Claude Code、Gemini CLI 等)',
  },
  'empty.existingBody': {
    en: '40+ mainstream coding agents speak ACP or can be exposed through a bridge; Claude Code is pinned by real-traffic contract tests. Connection paths:',
    zh: '40+ 主流 coding agent 说 ACP 或可经 bridge 暴露;Claude Code 由真实流量契约测试钉死。连接路径见',
  },
  'empty.userGuideLink': { en: 'User guide', zh: '使用指南' },
  'empty.userGuideUrl': {
    en: 'https://github.com/lukaisluka/Panda/blob/main/docs/user-guide.md',
    zh: 'https://github.com/lukaisluka/Panda/blob/main/docs/user-guide.md',
  },

  // ---- Composer ----
  'composer.placeholder': { en: 'Message Panda…', zh: '给 Panda 发消息…' },
  'composer.commands': { en: 'Slash commands', zh: '斜杠命令' },
  'composer.paramHint': { en: 'Input: {hint}', zh: '参数:{hint}' },
  'composer.removeAttachment': { en: 'Remove {name}', zh: '移除 {name}' },
  'composer.attach': { en: 'Add image', zh: '添加图片' },
  'composer.attachUnavailable': { en: 'This agent does not declare image input', zh: '当前 agent 未声明图片输入能力' },
  'composer.attachDisabled': { en: 'Cannot add images right now', zh: '当前不可添加图片' },
  'composer.settings': { en: 'Session settings', zh: '会话设置' },
  'composer.settingsDisabled': { en: 'Cannot change settings right now', zh: '当前不可调整设置' },
  'composer.stop': { en: 'Stop', zh: '停止' },
  'composer.send': { en: 'Send', zh: '发送' },
  'composer.readImageFailed': { en: 'Failed to read image: {message}', zh: '读取图片失败:{message}' },
  'composer.hintImages': {
    en: 'Enter to send, Shift+Enter for a new line · paste or pick images',
    zh: 'Enter 发送,Shift+Enter 换行 · 可粘贴或选择图片',
  },

  // ---- attachments ----
  'attach.oversize': { en: '>5MB, will not be sent', zh: '>5MB,不会发送' },
  'attach.tooMany': { en: 'Up to {n} images, will not be sent', zh: '最多 {n} 张,不会发送' },
  'attach.notImage': { en: 'Not an image file: {name}', zh: '不是图片文件: {name}' },
  'attach.pastedName': { en: 'Pasted image', zh: '粘贴的图片' },

  // ---- MessageStream ----
  'stream.compacting': { en: 'Compacting context…', zh: '正在压缩上下文…' },
  'stream.jumpToLatest': { en: 'Jump to latest', zh: '回到最新' },
  'stream.compacted': { en: 'Context compacted', zh: '上下文已压缩' },
  'stream.compactFailed': { en: 'Context compaction failed', zh: '上下文压缩失败' },
  'stream.compactFailedReason': { en: 'Context compaction failed: {error}', zh: '上下文压缩失败:{error}' },
  // The scroller's a11y name (#221): focusable but unnamed read as a bare
  // tab-stop to screen readers.
  'stream.transcript': { en: 'Conversation transcript', zh: '对话记录' },

  // ---- PermissionCard ----
  'perm.title': { en: 'Agent requests approval', zh: 'Agent 请求批准' },
  'perm.unknownOption': { en: '{name} (unknown option type)', zh: '{name}(未知选项类型)' },
  // What an「always」option actually remembers (#221): Panda's session-scoped
  // memory, keyed by the action's identity — not an agent-side setting.
  'perm.alwaysScopeTooltip': {
    en: 'Remembered for this session only: identical requests won’t ask again. It expires when the session ends or you switch.',
    zh: '仅本会话内记住:相同操作不再询问;会话结束或切换后失效。',
  },
  'perm.deniedByPolicy': { en: 'Denied by policy', zh: '已由策略拒绝' },
  'perm.autoAnswered': { en: 'Auto-answered {kind} (not by you)', zh: '已代答 {kind}(非用户决定)' },
  'perm.autoCancelled': {
    en: 'The agent offered no reject option; auto-answered cancelled (not by you)',
    zh: 'agent 未提供拒绝选项,已代答 cancelled(非用户决定)',
  },
  'perm.byPriorChoice': { en: "Auto-answered from this session's earlier choices", zh: '按本会话既往选择代答' },
  'perm.autoRejected': {
    en: 'You chose “reject always” for this action earlier this session; auto-rejected',
    zh: '你本会话曾对同一操作选择 reject_always,已自动拒绝',
  },
  'perm.autoAllowed': {
    en: 'You chose “allow always” for this action earlier this session; auto-allowed',
    zh: '你本会话曾对同一操作选择 allow_always,已自动放行',
  },
  'perm.allowOnce': { en: 'Allow', zh: '允许' },
  'perm.allowAlways': { en: 'Always allow', zh: '始终允许' },
  'perm.rejectOnce': { en: 'Reject', zh: '拒绝' },
  'perm.rejectAlways': { en: 'Always reject', zh: '始终拒绝' },
  'perm.approved': { en: 'Approved', zh: '已批准' },
  'perm.rejected': { en: 'Rejected', zh: '已拒绝' },

  // ---- ElicitationCard / ElicitationUrlCard ----
  'elicit.title': { en: 'Agent request', zh: 'Agent 请求信息' },
  'elicit.reject': { en: 'Decline', zh: '拒绝' },
  'elicit.submit': { en: 'Submit', zh: '提交' },
  'elicit.required': { en: 'Required', zh: '必填' },
  'elicit.unsupported': {
    en: 'Unsupported field type ({type}); this field cannot be filled in',
    zh: '暂不支持的字段类型({type}),此项不可填写',
  },
  'elicit.placeholderInteger': { en: 'Integer', zh: '整数' },
  'elicit.placeholderNumber': { en: 'Number', zh: '数字' },
  'elicit.done': { en: 'Done', zh: '已完成' },
  'elicit.submitted': { en: 'Submitted ({n} fields)', zh: '已提交({n} 项)' },
  'elicit.declined': { en: 'Declined', zh: '已拒绝' },
  'elicit.cancelled': { en: 'Cancelled (not by you)', zh: '已取消(非用户决定)' },
  'elicit.url.title': { en: 'External authorization', zh: '外部授权' },
  'elicit.url.opened': { en: 'Link opened; waiting for the external flow to finish…', zh: '链接已打开,等待外部流程完成…' },
  'elicit.url.gateTitle': { en: 'Agent request (external authorization)', zh: 'Agent 请求信息(外部授权)' },
  'elicit.url.punycode': {
    en: 'Domain contains Punycode (xn--) — beware of look-alike sites',
    zh: '域名含 Punycode(xn--),谨防仿冒站点',
  },
  'elicit.url.insecure': { en: 'Link is not HTTPS; transport is unprotected', zh: '链接不是 HTTPS,传输不受保护' },
  'elicit.url.unparseable': { en: 'Link could not be parsed; opening disabled', zh: '链接无法解析,已禁用打开' },
  'elicit.url.desc': {
    en: 'Clicking opens the link in a new browser tab; authorization completes on the external page.',
    zh: '点击后将在你的浏览器新标签页打开,授权在外部页面完成。',
  },
  'elicit.url.open': { en: 'Open link', zh: '打开链接' },

  // ---- ToolCallCard / DiffView ----
  'tool.awaitApproval': { en: 'Awaiting approval', zh: '等待批准' },
  'tool.queued': { en: 'Queued', zh: '排队中' },
  'tool.queuedTooltip': {
    en: 'Another tool in this batch is awaiting approval; approvals resume the whole batch — approving runs this call immediately',
    zh: '同批工具里有一个在等审批;审批是按整批一起恢复的,批准后这张卡立即执行',
  },
  'tool.running': { en: 'Running', zh: '执行中' },
  'tool.unsupportedBlock': { en: 'Unsupported content block ({type})', zh: '未支持的内容块({type})' },
  'tool.waitingApproval': { en: 'Waiting for approval…', zh: '等待批准后执行…' },
  'tool.waitingOutput': { en: 'Waiting for output…', zh: '等待输出…' },
  'tool.rawJson': { en: 'Raw JSON', zh: '原始 JSON' },
  // The tool-call domain stays English on purpose (maintainer call,
  // 2026-09-08): these labels share the row with agent-provided content —
  // tool names (write_todos), permission option names (Approve/Reject),
  // file paths — and translating half of that mix reads worse than keeping
  // the verbs/labels in English. Do not "fix" the zh column to Chinese.
  'tool.thinking': { en: 'Thinking', zh: 'Thinking' },
  'tool.thought': { en: 'Thought', zh: 'Thought' },
  'tool.verb.read': { en: 'Read', zh: 'Read' },
  'tool.verb.edit': { en: 'Edit', zh: 'Edit' },
  'tool.verb.delete': { en: 'Delete', zh: 'Delete' },
  'tool.verb.move': { en: 'Move', zh: 'Move' },
  'tool.input': { en: 'Input', zh: 'Input' },
  'tool.output': { en: 'Output', zh: 'Output' },
  'diff.copyPatch': { en: 'Copy patch', zh: '复制补丁' },
  'diff.fold': { en: '⋯ {n} unchanged lines', zh: '⋯ {n} 行未变更' },

  // ---- small blocks ----
  'clamp.collapse': { en: 'Collapse', zh: '收起' },
  'clamp.expand': { en: 'Expand all', zh: '展开全部' },
  'code.copy': { en: 'Copy code', zh: '复制代码' },
  'config.title': { en: 'Session settings', zh: '会话设置' },
  'mode.menu': { en: 'Session mode', zh: '会话模式' },
  'plan.dock': { en: 'Session plan', zh: '会话计划' },
  'plan.title': { en: 'Plan', zh: '计划' },
  // Counter semantics pinned by #220: completed-count, never "current step" —
  // the bare `N/M` read both ways, which read as progress that hadn't happened.
  'plan.progress': { en: '{done}/{total} done', zh: '{done}/{total} 已完成' },
  'unsupported.event': { en: 'Not-yet-supported ACP event · {kind}', zh: '暂不支持的 ACP 事件 · {kind}' },
  'turn.cancelled': { en: 'Cancelled', zh: '已取消' },
  'turn.refusal': { en: 'The model refused this request', zh: '模型拒绝了本次请求' },
  'turn.maxTokens': { en: 'Output hit the length limit (max_tokens)', zh: '输出达到长度上限(max_tokens)' },
  'turn.maxTurnRequests': { en: 'Hit the per-turn request limit (max_turn_requests)', zh: '达到单回合请求上限(max_turn_requests)' },

  // ---- AuthGate ----
  'auth.gateTitle': { en: 'This agent requires sign-in', zh: '此 agent 需要登录' },
  'auth.noMethods': {
    en: 'The agent provided no browser-usable sign-in method',
    zh: 'agent 未提供浏览器可用的登录方式',
  },

  // ---- NewSessionDialog ----
  'nsd.title': { en: 'New session', zh: '新建会话' },
  'nsd.subtitle': { en: 'Choose an agent to talk to', zh: '选择要对话的 agent' },
  'nsd.empty': {
    en: 'No agent profiles yet — add one in Settings, or use a custom address below for a temporary direct connection.',
    zh: '还没有 Agent 配置 — 在设置页添加,或用下方自定义地址临时直连。',
  },
  'nsd.newIn': { en: 'New session in {name}', zh: '在 {name} 中新建会话' },
  'nsd.connect': {
    en: 'Connect to {name} ({url}) — starts a new session once connected',
    zh: '连接 {name}({url})— 连接成功即进入新会话',
  },
  'nsd.custom': { en: 'Custom address', zh: '自定义地址' },
  'nsd.customToggle': { en: 'Custom address (advanced)', zh: '自定义地址(高级)' },
  'nsd.customHint': { en: 'Temporary direct connection; not saved as a profile.', zh: '临时直连,不保存为配置。' },
  'nsd.endpoint': { en: 'Endpoint', zh: '端点地址' },
  'nsd.workspace': { en: 'Workspace', zh: '工作区' },
  'nsd.localDir': { en: 'Local directory', zh: '本机文件夹' },
  'nsd.noWorkspace': { en: 'No workspace', zh: '无工作区' },
  'nsd.workspaceTooltip': {
    en: 'Workspace: the agent-side working context for a new session (ADR 0005)',
    zh: '工作区:新会话在 agent 侧的工作上下文(ADR 0005)',
  },
  'nsd.workspacePath': { en: 'Workspace path', zh: '工作区路径' },
  'nsd.connectStart': { en: 'Connect & start', zh: '连接并开始' },
  'nsd.endpointRequired': { en: 'Endpoint is required', zh: '端点地址不能为空' },
  'nsd.pathRequired': { en: 'A local directory needs a path', zh: '本机文件夹需要路径' },
  'nsd.busy': {
    en: 'A turn is still running on this agent — let it finish before starting a new session',
    zh: '这个 agent 还有轮次在跑,等它结束再新建会话',
  },

  // ---- Sidebar ----
  'side.sessions': { en: 'Sessions', zh: '会话' },
  'side.demoReplay': { en: 'Demo replay', zh: '演示回放' },
  'side.liveInBackground': {
    en: 'Live sessions · running in background',
    zh: 'Live 会话 · 后台运行中',
  },
  'side.newSession': { en: 'New session', zh: '新建会话' },
  'side.newSessionTooltip': {
    en: 'Pick an agent to start a new session (or use a custom address for a temporary direct connection)',
    zh: '选择 agent 开始新会话(可临时直连自定义地址)',
  },
  'side.noAgents': {
    en: 'No agents yet — add one with “Add agent” below, or use + above for a temporary direct connection',
    zh: '还没有 agent — 用下方「添加 agent」添加配置,或点上方 + 临时直连',
  },
  'side.addAgent': { en: 'Add agent', zh: '添加 agent' },
  'side.settings': { en: 'Settings', zh: '设置' },
  'side.settingsTooltip': { en: 'Settings: agent profiles, theme', zh: '设置:Agent 配置、主题' },
  'side.backToSession': { en: 'Back to session', zh: '返回会话' },
  'side.backToSessionTooltip': { en: 'Leave settings and return to the session view', zh: '离开设置,回到会话界面' },
  'side.profileNamePrompt': { en: 'Profile name', zh: '配置名称' },
  'side.temp': { en: 'Temp', zh: '临时' },
  'side.tempTooltip': {
    en: 'Temporary direct connection — not saved as a profile; it ends when disconnected',
    zh: '临时直连:未存为配置,断开即结束',
  },
  'side.managed': { en: 'Managed', zh: '托管' },
  'side.managedTooltip': {
    en: 'Managed by Justice Manager — connects automatically, no endpoint to configure',
    zh: '由 Justice Manager 托管:自动连接,无需配置端点',
  },
  'side.needsAttention': { en: 'Needs attention', zh: '需要关注' },
  'side.attentionTooltip': { en: 'Needs attention: {reasons}', zh: '需要关注:{reasons}' },
  'side.saveProfile': { en: 'Save as profile', zh: '存为配置' },
  'side.saveProfileTooltip': {
    en: 'Save the current endpoint & workspace as an agent profile (the connection stays up)',
    zh: '把当前端点与工作区保存为 Agent 配置(连接不打断)',
  },
  'side.disconnect': { en: 'Disconnect', zh: '断开连接' },
  'side.disconnectTemp': {
    en: 'Disconnect (this temporary direct connection ends here)',
    zh: '断开(临时直连到此结束)',
  },
  'side.disconnectSlot': {
    en: 'Disconnect (keeps the session slot; it can reconnect)',
    zh: '断开(保留会话槽,可重连)',
  },
  'side.connectProfile': { en: 'Connect', zh: '连接此配置' },
  'side.connectProfileTooltip': { en: 'Connect {name} ({url})', zh: '连接 {name}({url})' },
  'side.removeConnection': { en: 'Remove connection', zh: '移除连接' },
  'side.removeConnectionTooltip': {
    en: 'Remove (disconnect and clear this connection’s local session documents)',
    zh: '移除(断开并清除该连接的本地会话文档)',
  },
  'side.removeConfirm': {
    en: 'Remove connection “{title}”? Its local session records will be cleared (the endpoint’s remembered session list stays).',
    zh: '移除连接「{title}」?其本地会话记录将被清除(按端点记忆的会话列表保留)。',
  },
  'side.resume': { en: 'Reconnect & resume', zh: '重连并恢复会话' },
  'side.resumeTooltip': {
    en: 'Prefers resume to keep the current conversation; falls back to session/load when the agent does not support it',
    zh: '优先 resume 保留当前对话;agent 不支持时用 session/load 重建历史',
  },
  'side.reconnect': { en: 'Reconnect', zh: '重连' },
  'side.disabled.busy': { en: 'Wait for the current turn or switch to finish', zh: '等待当前回合或切换完成' },
  'side.disabled.offline': { en: 'Connect to view/switch this session', zh: '连接后可查看/切换该会话' },
  'side.disabled.host': { en: 'The host does not support session replay', zh: '宿主暂不支持会话回放' },
  'side.disabled.agent': {
    en: 'The agent does not support history replay (session/load)',
    zh: 'agent 不支持历史回放(session/load)',
  },
  'side.deleteSession': { en: 'Delete session', zh: '删除会话' },
  'side.deleteSessionTooltip': { en: 'Delete session (session/delete)', zh: '删除会话(session/delete)' },
  'side.time.justNow': { en: 'just now', zh: '刚刚' },
  'side.time.minutesAgo': { en: '{n} min ago', zh: '{n} 分钟前' },
  'side.time.hoursAgo': { en: '{n} h ago', zh: '{n} 小时前' },
  'side.time.daysAgo': { en: '{n} d ago', zh: '{n} 天前' },
  'side.attention.unreadCompletion': { en: 'Unread completion', zh: '未读完成' },
  'side.attention.pendingPermission': { en: 'Permission pending', zh: '权限待处理' },
  'side.attention.connectionError': { en: 'Connection error', zh: '连接错误' },
  'side.attention.authRequired': { en: 'Sign-in required', zh: '需要登录' },

  // ---- SettingsPage ----
  'settings.title': { en: 'Settings', zh: '设置' },
  'settings.general': { en: 'General', zh: '通用' },
  'settings.generalDesc': {
    en: 'Appearance theme and interface language.',
    zh: '外观主题与界面语言。',
  },
  // Codex-style row labels (#138): one setting per row — title + description
  // on the left, control on the right. Group titles head the row cards.
  'settings.appearanceGroup': { en: 'Appearance & language', zh: '外观与语言' },
  'settings.themeRow': { en: 'Theme', zh: '主题' },
  'settings.themeRowDesc': { en: 'The color scheme of the whole interface.', zh: '整个界面的配色。' },
  'settings.themeMore': { en: 'More themes coming soon', zh: '更多主题将陆续开放' },
  'settings.language': { en: 'Language', zh: '语言' },
  'settings.languageRowDesc': { en: 'Display language of the interface.', zh: '界面的显示语言。' },
  'settings.uiFontRow': { en: 'UI font size', zh: '界面字号' },
  'settings.uiFontRowDesc': { en: 'Base size of the interface; secondary text scales with it.', zh: '界面的基准字号，次要文字随之缩放。' },
  'settings.codeFontRow': { en: 'Code font size', zh: '代码字号' },
  'settings.codeFontRowDesc': { en: 'Font size of code blocks and other mono content.', zh: '代码块与等宽内容的字号。' },
  'settings.fontSmaller': { en: 'Smaller', zh: '调小' },
  'settings.fontLarger': { en: 'Larger', zh: '调大' },
  'settings.envGroup': { en: 'Environment', zh: '运行环境' },
  'settings.versionRow': { en: 'Version', zh: '版本' },
  'settings.hostRow': { en: 'Host', zh: '宿主' },
  'settings.hostBrowser': { en: 'Browser', zh: '浏览器' },
  'settings.hostDesktop': { en: 'Desktop app', zh: '桌面版' },
  'settings.userAgentRow': { en: 'Browser & OS', zh: '浏览器与系统' },
  'settings.reportGroup': { en: 'Diagnostics report', zh: '诊断报告' },
  'settings.reportRowDesc': {
    en: 'Environment and the recent console log, copied to the clipboard for a bug report.',
    zh: '环境信息与最近控制台日志,复制到剪贴板,可附在问题反馈里。',
  },
  'settings.devRowDesc': { en: 'Replay the scripted agent — no real connection.', zh: '回放剧本 agent,不连真实服务。' },
  'settings.locale.en': { en: 'English', zh: 'English' },
  'settings.locale.zh': { en: '中文', zh: '中文' },
  'settings.profiles': { en: 'Agent profiles', zh: 'Agent 配置' },
  'settings.profilesGroup': { en: 'Saved profiles', zh: '已保存的配置' },
  'settings.addProfile': { en: 'Add profile', zh: '新增配置' },
  'settings.profilesDesc': {
    en: 'Save agent endpoints and default workspaces to pick directly when starting a session.',
    zh: '保存 agent 的端点地址与默认工作区,新建会话时直接选用。',
  },
  'settings.noProfiles': { en: 'No agent profiles yet', zh: '还没有 Agent 配置' },
  'settings.noProfilesDesc': {
    en: 'Add one and it becomes directly selectable when starting a session.',
    zh: '新增一条,之后新建会话时就能直接选这个 agent。',
  },
  'settings.editProfile': { en: 'Edit profile', zh: '编辑配置' },
  'settings.editProfileTooltip': {
    en: 'Edit the name, endpoint, or default workspace',
    zh: '编辑名称、端点地址或默认工作区',
  },
  'settings.deleteProfile': { en: 'Delete profile', zh: '删除配置' },
  'settings.deleteProfileTooltip': {
    en: 'Delete this profile (the endpoint’s remembered sessions are untouched)',
    zh: '删除这条配置(不影响该端点已记忆的会话)',
  },
  'settings.deleteProfileConfirm': {
    en: 'Delete profile “{name}”? The endpoint’s remembered sessions are unaffected.',
    zh: '删除配置「{name}」?该端点已记忆的会话不受影响。',
  },
  'settings.mcp': { en: 'MCP servers', zh: 'MCP 服务器' },
  'settings.mcpGroup': { en: 'Saved servers', zh: '已保存的服务器' },
  'settings.addMcp': { en: 'Add server', zh: '新增服务器' },
  'settings.mcpModeLabel': { en: 'Input mode', zh: '输入方式' },
  'settings.mcpModeForm': { en: 'Form', zh: '表单' },
  'settings.mcpModeText': { en: 'Text', zh: '文本' },
  'settings.mcpFormatLabel': { en: 'Config format', zh: '配置格式' },
  'settings.mcpFormatBtn': { en: 'Format', zh: '格式化' },
  'settings.mcpSaveCount': { en: 'Save {n} server(s)', zh: '保存 {n} 条' },
  'settings.mcpParseError': { en: 'Cannot parse', zh: '无法解析' },
  'settings.mcpDirtyConfirm': {
    en: 'Discard unsaved changes to the text config?',
    zh: '放弃文本配置的未保存修改?',
  },
  'settings.mcpDirtyTitle': { en: 'Unsaved changes', zh: '有未保存的修改' },
  'settings.mcpDirtyLeave': { en: 'Discard & leave', zh: '放弃并离开' },
  'settings.mcpDroppedFields': {
    en: 'Fields Panda does not store were dropped: {fields}',
    zh: 'Panda 暂不存储的字段已丢弃:{fields}',
  },
  'settings.mcpPlaceholders': {
    en: 'Some values contain ${{…}} placeholders — imported literally, replace them yourself if needed.',
    zh: '部分值含 ${{…}} 占位符,已按字面导入,需要时请自行替换。',
  },
  'settings.mcpRenamed': { en: 'Duplicate names suffixed: {names}', zh: '重名已加序号后缀:{names}' },
  'settings.mcpSkipMissingName': { en: 'entry has no name', zh: '条目缺少名称' },
  'settings.mcpSkipInvalid': { en: 'entry is not a config object', zh: '条目不是配置对象' },
  'settings.mcpSkipMissingCommand': { en: 'stdio needs a command', zh: 'stdio 缺少命令' },
  'settings.mcpSkipMissingUrl': { en: 'remote needs a URL', zh: '远程类型缺少 URL' },
  'settings.mcpSkipUnsupportedType': {
    en: 'transport type Panda cannot host (stdio / http / sse only)',
    zh: 'Panda 不支持该传输类型(仅 stdio / http / sse)',
  },
  'settings.mcpDesc': {
    en: 'Configured tool servers ride every session/new · session/load to the agent, which connects and obtains their tools; stdio commands run on the agent’s host. Changes apply to the next session.',
    zh: '配置的工具服务会随每个新建/载入的会话下发给 agent,由 agent 侧连接并取得工具;stdio 命令在 agent 所在主机上执行。修改对下一个会话生效。',
  },
  'settings.noMcp': { en: 'No MCP servers yet', zh: '还没有 MCP 服务器' },
  'settings.noMcpDesc': {
    en: 'Add one and the agent can use the tools it provides in sessions.',
    zh: '新增一条,agent 就能在会话里用到它提供的工具。',
  },
  'settings.editMcp': { en: 'Edit server', zh: '编辑服务器' },
  'settings.editMcpTooltip': { en: 'Edit the name, type, or launch parameters', zh: '编辑名称、类型或启动参数' },
  'settings.deleteMcp': { en: 'Delete server', zh: '删除服务器' },
  'settings.deleteMcpTooltip': {
    en: 'Delete this MCP server config (existing sessions are untouched)',
    zh: '删除这条 MCP 服务器配置(不影响已建立的会话)',
  },
  'settings.deleteMcpConfirm': { en: 'Delete MCP server “{name}”?', zh: '删除 MCP 服务器「{name}」?' },
  'settings.serverName': { en: 'Server name', zh: '服务器名称' },
  'settings.serverNamePlaceholder': { en: 'e.g. filesystem', zh: '如:filesystem' },
  'settings.type': { en: 'Type', zh: '类型' },
  'settings.profileType': { en: 'Connection type', zh: '连接方式' },
  'settings.typeWebsocket': { en: 'WebSocket (remote service)', zh: 'WebSocket(远程服务)' },
  'settings.profileTypeTooltip': {
    en: 'stdio spawns a local agent process and speaks ACP over its stdin/stdout',
    zh: 'stdio 在本机拉起 agent 进程,经其 stdin/stdout 通信',
  },
  'settings.stdioDesktopOnly': {
    en: 'Panda desktop app only (spawns a local process)',
    zh: '仅 Panda 桌面版可用(在本机拉起进程)',
  },
  'settings.agentCommandPlaceholder': {
    en: 'e.g. node your-agent.mjs (see the agent quickstart)',
    zh: '如:node your-agent.mjs(见 agent 快速入门)',
  },
  'settings.commandRequired': {
    en: 'stdio needs an executable command',
    zh: 'stdio 需要可执行命令',
  },
  'settings.typeStdio': { en: 'stdio (command on the agent host)', zh: 'stdio(agent 主机命令)' },
  'settings.typeHttp': { en: 'HTTP (Streamable)', zh: 'HTTP(Streamable)' },
  'settings.typeSse': { en: 'SSE', zh: 'SSE' },
  'settings.typeTooltip': {
    en: 'stdio spawns a process on the agent host; HTTP/SSE is dialed by the agent',
    zh: 'stdio 由 agent 所在主机拉起进程;HTTP/SSE 由 agent 侧按 URL 拨号',
  },
  'settings.command': { en: 'Command', zh: '命令' },
  'settings.commandPlaceholder': {
    en: 'e.g. npx -y @modelcontextprotocol/server-filesystem',
    zh: '如:npx -y @modelcontextprotocol/server-filesystem',
  },
  'settings.args': { en: 'Arguments (space-separated)', zh: '参数(空格分隔)' },
  'settings.argsPlaceholder': { en: 'e.g. /path/to/dir --another', zh: '如:/path/to/dir --another' },
  'settings.mcpEditNote': {
    en: 'Changes apply to the next session/new or session/load.',
    zh: '修改在下一个新建/载入的会话生效。',
  },
  'settings.save': { en: 'Save', zh: '保存' },
  'settings.create': { en: 'Create', zh: '创建' },
  'settings.cancel': { en: 'Cancel', zh: '取消' },
  // 测试连接 (#221): handshake-then-drop verdict on the profile form.
  'settings.testConnection': { en: 'Test connection', zh: '测试连接' },
  'settings.testConnectionRunning': { en: 'Testing…', zh: '测试中…' },
  'settings.testOk': {
    en: 'Reached: {agent} (protocol v{v}) — the link was closed after the handshake',
    zh: '连通:{agent}(协议 v{v})——握手后已断开',
  },
  'settings.testFailed': { en: 'Failed: {error}', zh: '失败:{error}' },
  // Post-create CTA (#221): a saved profile used to dead-end on the list.
  'settings.profileSavedTitle': { en: 'Profile saved', zh: '配置已保存' },
  'settings.profileSavedDesc': {
    en: '“{name}” is ready — its slot appears in the sidebar.',
    zh: '「{name}」已就绪,侧栏会出现它的分组。',
  },
  'settings.startSessionCtaNamed': { en: 'Start a session with {name}', zh: '用 {name} 开始会话' },
  'settings.done': { en: 'Done', zh: '完成' },
  'settings.profileName': { en: 'Profile name', zh: '配置名称' },
  'settings.profileNamePlaceholder': { en: 'e.g. test-agent', zh: '如:test-agent' },
  'settings.endpoint': { en: 'Endpoint', zh: '端点地址' },
  'settings.defaultWorkspace': { en: 'Default workspace', zh: '默认工作区' },
  'settings.workspaceTooltip': {
    en: 'The agent-side working context used by default for new sessions (ADR 0005)',
    zh: '新建会话时默认使用的 agent 侧工作上下文(ADR 0005)',
  },
  'settings.editNote': {
    en: 'Endpoint and workspace changes apply on the next connection.',
    zh: '端点与工作区的修改在下一次连接时生效。',
  },
  'settings.profileMcpGroup': { en: 'MCP servers', zh: 'MCP 服务器' },
  'settings.profileMcpDesc': {
    en: 'Checked servers ride this agent\'s sessions; unchecked ones stay off it.',
    zh: '勾选的服务器随该 agent 的会话加载,未勾选的不加载。',
  },
  'settings.profileMcpEmpty': {
    en: 'No MCP servers configured yet — add them on the MCP page.',
    zh: '还没有配置 MCP 服务器——可在 MCP 分区添加。',
  },
  'settings.deleteMcpConfirmUsed': {
    en: 'Delete MCP server “{name}”? {n} agent profile(s) include it.',
    zh: '删除 MCP 服务器「{name}」?有 {n} 个 agent 配置正在使用它。',
  },
  'settings.nameRequired': { en: 'Profile name is required', zh: '配置名称不能为空' },
  'settings.endpointRequired': { en: 'Endpoint is required', zh: '端点地址不能为空' },
  'settings.pathRequired': { en: 'A local directory needs a path', zh: '本机文件夹需要路径' },
  'settings.mcpNameRequired': { en: 'Server name is required', zh: '服务器名称不能为空' },
  'settings.mcpCommandRequired': { en: 'stdio type needs an executable command', zh: 'stdio 类型需要可执行命令' },
  'settings.mcpUrlRequired': { en: 'A URL is required', zh: '需要一个 URL' },
  'settings.dev': { en: 'Developer', zh: '开发者' },
  'settings.demoReplay': { en: 'Demo replay', zh: 'Demo 回放' },
  'settings.demoReplayTooltip': {
    en: 'Open the #/demo scripted replay (no real agent); re-entering replays from the start',
    zh: '打开 #/demo 剧本回放(不连真实 agent);重新进入即从头重放',
  },

  // ---- diagnostics (#105): crash fallback + settings diagnostics card ----
  'diag.crashTitle': { en: 'Panda hit an error', zh: 'Panda 遇到了错误' },
  'diag.crashDesc': {
    en: 'The interface stopped rendering. Copy the diagnostics report (error, component stack, recent console log) and reload.',
    zh: '界面停止渲染了。复制诊断报告(错误、组件栈、最近控制台日志)后重新加载。',
  },
  'diag.copyDiagnostics': { en: 'Copy diagnostics', zh: '复制诊断信息' },
  'diag.copied': { en: 'Copied', zh: '已复制' },
  'diag.copyFailed': { en: 'Copy failed', zh: '复制失败' },
  'diag.reload': { en: 'Reload', zh: '重新加载' },
  'diag.cardTitle': { en: 'Diagnostics', zh: '诊断' },
  'diag.cardDesc': {
    en: 'Copy a diagnostics report (app environment and the recent console log — nothing leaves your browser) to attach to a bug report.',
    zh: '复制诊断报告(应用环境与最近控制台日志——数据不会离开你的浏览器),可附在问题反馈里。',
  },
  'settings.colophon': {
    en: 'Panda — a pure-protocol client for any ACP agent',
    zh: 'Panda — 连接任意 ACP agent 的纯协议客户端',
  },

  // ---- workspace ----
  'workspace.none': { en: 'No workspace', zh: '无工作区' },

  // ---- lifecycle projection (busy line / hints) ----
  'lifecycle.awaitingApproval': { en: 'Awaiting approval…', zh: '等待批准中…' },
  // Composer placeholder while a permission/elicitation waits (#216): the
  // input stays writable for drafting, so the copy must say where the real
  // action is instead of claiming work is in progress.
  'lifecycle.awaitingApprovalHint': {
    en: 'Awaiting your approval — respond in the message stream',
    zh: '等待你的批准 — 在消息流中处理',
  },
  'lifecycle.working': { en: 'Panda is working…', zh: 'Panda 正在工作…' },
  'lifecycle.workingGateway': { en: 'Working…', zh: '处理中…' },
  'lifecycle.connecting': { en: 'Connecting…', zh: '连接中…' },
  'lifecycle.connectFailed': {
    en: 'Connection failed — reconnect & resume from the sidebar, or connect again',
    zh: '连接失败 — 在侧栏重连并恢复,或重新连接',
  },
  'lifecycle.authRequired': {
    en: 'Sign-in required — pick a login method above',
    zh: '需要登录 — 在上方选择登录方式',
  },
  'lifecycle.disconnected': {
    en: 'Not connected to an ACP service — connect from the sidebar',
    zh: '未连接 ACP 服务 — 在侧栏连接',
  },
  'lifecycle.switching': { en: 'Switching session…', zh: '切换会话中…' },

  // ---- live connection driver ----
  'live.switchFailedTitled': {
    en: 'Switching to “{title}” failed: {reason}',
    zh: '切换到「{title}」失败:{reason}',
  },
  'live.retrySwitch': { en: 'Retry', zh: '重试' },
  'live.notice.unknownConnection': { en: 'That connection no longer exists.', zh: '该连接已不存在。' },
  'settings.notice.saveFailed': {
    en: 'Could not save the agent configuration (storage rejected the write).',
    zh: 'agent 配置保存失败(存储写入被拒)。',
  },

  // ---- ACP client errors (surface via connection.error) ----
  'acp.timeout': { en: '{method} timed out after {s}s', zh: '{method} 超过 {s}s 未应答' },
  // #217: a pre-handshake close is a connect failure — code 1006 collapses
  // refused/unreachable/rejected, so the copy points at the usual causes
  // (agent not running / wrong path) instead of "the server closed".
  'acp.disconnected': { en: 'Connection lost — reconnect from the sidebar', zh: '连接已断开——可从侧栏重连' },
  'acp.connectRefused': {
    en: 'Could not connect — make sure the agent is running at this address and the path points at its ACP endpoint',
    zh: '无法连接——请确认 agent 已在该地址启动、且路径指向它的 ACP 端点',
  },
  'acp.connectClosedEarly': {
    en: 'The connection closed before the session could be established',
    zh: '会话尚未建立,连接即被关闭',
  },
  'acp.protocolMismatch': {
    en: 'the agent negotiated protocol v{agent}, but Panda currently supports only v{ours}',
    zh: 'agent 协商了协议 v{agent},Panda 目前只支持 v{ours}',
  },
  'acp.authNoMethods': {
    en: 'The agent requires authentication but provided no browser-usable login method',
    zh: 'agent 要求认证,但没有提供浏览器可用的登录方式',
  },
  'acp.connectFailed': { en: 'Connection failed: {error}', zh: '连接失败: {error}' },
  'acp.stdioHostMissing': {
    en: 'stdio agents require the Panda desktop app',
    zh: 'stdio agent 需要在 Panda 桌面版中连接',
  },
  'acp.newSessionFailed': { en: 'New session failed: {error}', zh: '新建会话失败: {error}' },
  // 测试连接 (#221) guard rails: the missing-endpoint refusal, and the
  // never-settled sentinel — the probe's handlers must overwrite it.
  'acp.testMissingEndpoint': { en: 'An endpoint is required to test', zh: '缺少端点,无法测试' },
  'acp.testNoOutcome': { en: 'Test produced no result', zh: '测试未返回结果' },
  // ---- operation notices (#160): console-only guard/failure paths surfaced as toasts ----
  'acp.notice.notConnected': { en: 'Not connected to the agent — reconnect first.', zh: '尚未连接 agent,请先重连。' },
  // Ignored-reconnect exits (#238): the request itself was dropped, so the
  // click must still answer — plain cause + remedy copy, one per exit.
  'acp.notice.reconnectNoConnection': {
    en: 'No connection selected — pick an agent in the sidebar first.',
    zh: '未选择连接——请先在侧栏选择一个 agent。',
  },
  'acp.notice.reconnectNoTarget': {
    en: 'This session has no remembered connection target — connect again from New session.',
    zh: '该会话槽没有记住的连接目标——请从「新建会话」重新连接。',
  },
  'acp.notice.reconnectNoWorkspace': {
    en: 'This session has no remembered workspace — connect again from New session.',
    zh: '该会话槽没有记住的工作区——请从「新建会话」重新连接。',
  },
  'acp.notice.busy': { en: 'The agent is busy (a turn or a session switch is still in flight) — try again shortly.', zh: 'agent 正忙(回合或会话切换仍在进行),请稍后再试。' },
  'acp.notice.loadUnsupported': {
    en: 'This agent does not support session/load — switching to another session is unavailable.',
    zh: '该 agent 不支持 session/load,无法切换到其他会话。',
  },
  'acp.notice.deleteUnsupported': { en: 'This agent does not support session/delete.', zh: '该 agent 不支持 session/delete。' },
  'acp.notice.listFailed': { en: 'Session list fetch failed: {error}', zh: '会话列表拉取失败:{error}' },
  'acp.notice.permissionGone': {
    en: 'That permission request is no longer pending — the answer was not delivered.',
    zh: '该权限请求已不在等待应答,本次应答未能送达。',
  },
  'acp.loginFailed': { en: 'Sign-in failed: {error}', zh: '登录失败: {error}' },
  'acp.deleteSessionFailed': { en: 'Session deletion failed: {error}', zh: '删除会话失败: {error}' },
  'acp.imageHostUnsupported': { en: 'the host does not support this capability', zh: '宿主不支持该能力' },
  'acp.imagePolicyBlocked': { en: 'policy blocks this capability', zh: '策略已禁止该能力' },
  'acp.imageNotDeclared': {
    en: 'the agent did not declare promptCapabilities.image',
    zh: 'agent 未声明 promptCapabilities.image',
  },
  'acp.imageRejected': { en: '{cause} — refusing to send images', zh: '{cause},拒绝发送图片' },
  'acp.superseded': { en: 'The connection was replaced by a newer one', zh: '连接已被更新的连接替换' },

  // ---- wire ----
  'wire.unnamedTool': { en: 'Unnamed action', zh: '未命名操作' },

  // ---- Gateway login gate (Phase 3): production-gateway-build only, never
  // shown in the GitHub Pages demo build. ----
  'gateway.checkingSession': { en: 'Checking your session…', zh: '正在检查登录状态…' },
  'gateway.title': { en: 'JusticeOS', zh: 'JusticeOS' },
  'gateway.tagline': { en: 'Sign in to reach your Insurance Audit Agent', zh: '登录以连接你的 Insurance Audit Agent' },
  'gateway.passwordLabel': { en: 'Password', zh: '密码' },
  'gateway.passwordPlaceholder': { en: 'Enter password', zh: '输入密码' },
  'gateway.signIn': { en: 'Sign in', zh: '登录' },
  'gateway.signingIn': { en: 'Signing in…', zh: '登录中…' },
  'gateway.invalidCredentials': { en: 'Incorrect password. Try again.', zh: '密码不正确,请重试。' },
  'gateway.throttled': {
    en: 'Too many attempts. Wait a few minutes and try again.',
    zh: '尝试次数过多,请等待几分钟后重试。',
  },
  'gateway.unavailable': {
    en: 'JusticeOS is temporarily unavailable. Try again shortly.',
    zh: 'JusticeOS 暂时不可用,请稍后重试。',
  },
  'gateway.sessionExpired': {
    en: 'Your session expired. Sign in again to continue.',
    zh: '登录已过期,请重新登录。',
  },
  'gateway.loggedOut': { en: 'Signed out.', zh: '已退出登录。' },
  'gateway.logout': { en: 'Sign out', zh: '退出登录' },
  'gateway.loggingOut': { en: 'Signing out…', zh: '正在退出…' },

  // ---- Gateway build: JusticeOS composer/crash overrides (production-
  // gateway-build only -- the demo build keeps composer.placeholder /
  // diag.crashTitle unchanged). ----
  'composer.gatewayPlaceholder': { en: 'Message your Insurance Audit Agent…', zh: '给 Insurance Audit Agent 发消息…' },
  'diag.crashTitleGateway': { en: 'JusticeOS hit an error', zh: 'JusticeOS 遇到了错误' },

  // ---- Gateway build: connecting state (replaces EmptyState's demo/
  // connect-your-own-agent onboarding, which never applies here -- the
  // managed connection dials itself). ----
  'gateway.connectingTitle': { en: 'Connecting…', zh: '正在连接…' },
  'gateway.connectingBody': {
    en: 'Reaching your Insurance Audit Agent. This finishes automatically.',
    zh: '正在连接你的 Insurance Audit Agent,会自动完成。',
  },

  // ---- Agent rail (JusticeOS dashboard, gateway build only): the narrow
  // always-visible left rail that replaces the generic multi-agent
  // Sidebar in this build. ----
  'rail.home': { en: 'Home', zh: '主页' },
  'rail.homeTooltip': { en: 'Dashboard home', zh: '仪表盘主页' },
  'rail.agentTooltip': { en: 'Open {name}', zh: '打开 {name}' },
  'rail.settings': { en: 'Settings', zh: '设置' },
  'rail.settingsTooltip': { en: 'Settings', zh: '设置' },
  'rail.signOut': { en: 'Sign out', zh: '退出登录' },
  // ---- Collapsible sidebar (desktop collapse/expand + mobile drawer). ----
  'rail.openAgents': { en: 'Open agents', zh: '打开 agent 列表' },
  'rail.closeAgents': { en: 'Close agents', zh: '关闭 agent 列表' },
  'rail.collapse': { en: 'Collapse sidebar', zh: '收起侧栏' },
  'rail.expand': { en: 'Expand sidebar', zh: '展开侧栏' },

  // ---- Dashboard home screen (JusticeOS, gateway build only). ----
  'dashboard.heading': { en: 'JusticeOS', zh: 'JusticeOS' },
  'dashboard.greeting.morning': { en: 'Good morning', zh: '早上好' },
  'dashboard.greeting.afternoon': { en: 'Good afternoon', zh: '下午好' },
  'dashboard.greeting.evening': { en: 'Good evening', zh: '晚上好' },
  'dashboard.briefing.title': { en: 'Justice Manager briefing', zh: 'Justice Manager 简报' },
  'dashboard.briefing.placeholder': {
    en: 'Your briefing will appear here once your Justice Manager is available.',
    zh: '当 Justice Manager 可用后,你的简报会显示在这里。',
  },
  // 'dashboard.agentCard.title' doubles as the managed connection's fallback
  // display name (AgentRail's aria-label etc.) even though the dashboard no
  // longer shows an agent card of its own -- agent navigation lives only in
  // the sidebar now (brand brief: "The dashboard must not become another
  // agent picker").
  'dashboard.agentCard.title': { en: 'Insurance Audit Agent', zh: 'Insurance Audit Agent' },
  'dashboard.card.attention': { en: 'Needs your attention', zh: '需要你关注' },
  'dashboard.card.inProgress': { en: 'In progress', zh: '进行中' },
  'dashboard.card.completed': { en: 'Recently completed', zh: '最近完成' },
  'dashboard.card.failedBlocked': { en: 'Failed or blocked', zh: '失败或受阻' },
  'dashboard.card.findings': { en: 'Audit & compliance findings', zh: '审计与合规发现' },
  'dashboard.card.documents': { en: 'Recent documents & reports', zh: '最近的文档与报告' },
  'dashboard.card.upcoming': { en: 'Upcoming deadlines & follow-ups', zh: '即将到来的截止日期与跟进' },
  'dashboard.empty.attention': { en: 'Nothing needs your attention right now.', zh: '目前没有需要关注的事项。' },
  'dashboard.empty.inProgress': { en: 'Nothing is in progress right now.', zh: '目前没有进行中的事项。' },
  'dashboard.empty.completed': { en: 'No completed work has been reported yet.', zh: '尚无已完成工作的记录。' },
  'dashboard.empty.failedBlocked': { en: 'Nothing has failed or is blocked right now.', zh: '目前没有失败或受阻的事项。' },
  'dashboard.empty.findings': { en: 'No findings have been reported yet.', zh: '尚无发现报告。' },
  'dashboard.empty.documents': { en: 'No documents or reports have been produced yet.', zh: '尚未生成任何文档或报告。' },
  'dashboard.empty.upcoming': { en: 'Nothing scheduled yet.', zh: '暂无安排。' },
  'dashboard.attention.pendingPermission': {
    en: 'The Insurance Audit Agent is waiting on your approval.',
    zh: 'Insurance Audit Agent 正在等待你的批准。',
  },
  'dashboard.attention.unreadCompletion': {
    en: 'The Insurance Audit Agent finished a response you haven’t seen yet.',
    zh: 'Insurance Audit Agent 完成了一条你还未查看的回复。',
  },
  'dashboard.attention.connectionError': {
    en: 'The Insurance Audit Agent connection needs attention.',
    zh: 'Insurance Audit Agent 的连接需要处理。',
  },
  'dashboard.inProgress.running': {
    en: 'The Insurance Audit Agent is working on your current conversation.',
    zh: 'Insurance Audit Agent 正在处理你当前的对话。',
  },

  // ---- Floating Justice Manager chat button + placeholder panel
  // (dashboard home, gateway build only). Phase 1: no manager backend
  // exists yet -- the panel says so plainly rather than pretending to
  // be operational. ----
  'manager.openTooltip': { en: 'Chat with your Justice Manager', zh: '与 Justice Manager 对话' },
  'manager.panelTitle': { en: 'Justice Manager', zh: 'Justice Manager' },
  'manager.panelClose': { en: 'Close', zh: '关闭' },
  'manager.placeholderBody': {
    en: 'Justice Manager chat is not connected yet. This is a placeholder for an upcoming feature -- nothing you type here is sent anywhere.',
    zh: 'Justice Manager 对话尚未接入,这是即将推出功能的占位界面 —— 你在这里输入的内容不会被发送。',
  },

// ---- marketing workspace (#/marketing) ----
  'mkt.title': { en: 'Marketing', zh: '营销' },
  'mkt.navLabel': { en: 'Marketing workspace', zh: '营销工作台' },
  'mkt.navTooltip': { en: 'Review campaigns awaiting your decision', zh: '查看待你决策的营销活动' },
  'mkt.headerMeta': { en: 'Campaign review', zh: '活动审阅' },
  'mkt.loading': { en: 'Loading…', zh: '加载中…' },
  'mkt.retry': { en: 'Try again', zh: '重试' },
  'mkt.refresh': { en: 'Refresh', zh: '刷新' },

  // queue
  'mkt.queue.title': { en: 'Review queue', zh: '审阅队列' },
  'mkt.queue.count': { en: '{count} awaiting review', zh: '{count} 个待审阅' },
  'mkt.queue.empty': { en: 'Nothing is waiting for review.', zh: '暂无待审阅的活动。' },
  'mkt.queue.emptyHint': {
    en: 'Campaigns appear here once the Marketing Agent has generated them.',
    zh: '营销 Agent 生成活动后会出现在这里。',
  },
  'mkt.queue.openReview': { en: 'Open review', zh: '打开审阅' },
  'mkt.state.ready': { en: 'Ready for approval', zh: '可批准' },
  'mkt.state.blocked': { en: 'Needs attention', zh: '需要处理' },
  'mkt.state.changesRequested': { en: 'Changes requested', zh: '已提出修改' },
  'mkt.state.notReviewable': { en: 'Not reviewable', zh: '不可审阅' },
  'mkt.card.revision': { en: 'Revision {number}', zh: '第 {number} 版' },
  'mkt.card.objective': { en: 'Objective', zh: '目标' },
  'mkt.card.trade': { en: 'Trade', zh: '工种' },
  'mkt.card.market': { en: 'Project location', zh: '项目位置' },
  'mkt.card.serviceArea': { en: 'Service area', zh: '服务区域' },
  'mkt.card.channels': { en: 'Channels', zh: '渠道' },
  'mkt.card.media': { en: '{count} media', zh: '{count} 个素材' },
  'mkt.card.blockers': { en: '{count} blockers', zh: '{count} 项阻断' },
  'mkt.card.changeRequests': { en: '{count} open change requests', zh: '{count} 个未处理的修改请求' },
  'mkt.card.updated': { en: 'Updated {time}', zh: '更新于 {time}' },
  'mkt.card.created': { en: 'Created {time}', zh: '创建于 {time}' },
  'mkt.card.none': { en: '—', zh: '—' },

  // review workspace
  'mkt.review.back': { en: 'Back to queue', zh: '返回队列' },
  'mkt.review.current': { en: 'Current revision', zh: '当前版本' },
  'mkt.review.historical': { en: 'Historical revision', zh: '历史版本' },
  'mkt.review.historicalHint': {
    en: 'You are viewing an earlier revision. It cannot be approved or edited.',
    zh: '你正在查看较早的版本,它不能被批准或编辑。',
  },
  'mkt.review.why': { en: 'Why this campaign', zh: '为什么是这个活动' },
  'mkt.review.angle': { en: 'Campaign angle', zh: '活动角度' },
  'mkt.review.rationale': { en: 'Why it was selected', zh: '选择理由' },
  'mkt.review.researchMode': { en: 'Research', zh: '调研' },
  'mkt.review.researchInfluence': { en: 'Research influence', zh: '调研影响' },
  'mkt.review.researchDetails': { en: 'Research details', zh: '调研详情' },
  'mkt.review.researchNone': { en: 'No research shaped this campaign.', zh: '本次活动未使用调研。' },
  'mkt.review.facts': { en: 'Verified project facts', zh: '已核实的项目事实' },
  'mkt.review.media': { en: 'Media', zh: '素材' },
  'mkt.review.assumptions': { en: 'Assumptions', zh: '前提假设' },
  'mkt.review.blockers': { en: 'Blockers', zh: '阻断项' },
  'mkt.review.blockersHint': {
    en: 'Approval stays disabled until these are resolved.',
    zh: '在这些问题解决前,批准保持禁用。',
  },
  'mkt.review.channels': { en: 'Channel previews', zh: '渠道预览' },
  'mkt.review.history': { en: 'Revision history', zh: '版本历史' },
  'mkt.review.activity': { en: 'Activity', zh: '操作记录' },
  'mkt.review.changeRequests': { en: 'Change requests', zh: '修改请求' },
  'mkt.review.technical': { en: 'Technical details', zh: '技术详情' },
  'mkt.review.decision': { en: 'Decision', zh: '决定' },

  // facts
  'mkt.facts.authorized': { en: 'Authorized for marketing', zh: '已授权用于营销' },
  'mkt.facts.internalOnly': { en: 'Internal only', zh: '仅限内部' },
  'mkt.facts.internalOnlyHint': {
    en: 'Field names only — these values never leave the Marketing Agent.',
    zh: '仅字段名称——这些值不会离开营销 Agent。',
  },
  'mkt.facts.unknown': { en: 'Unknown', zh: '未知' },
  'mkt.facts.unknownHint': { en: 'Never asserted in public copy.', zh: '不会出现在对外文案中。' },
  'mkt.facts.changed': { en: 'Changed since this revision was generated', zh: '自本版本生成后已变更' },
  'mkt.facts.none': { en: 'No verified project context for this campaign.', zh: '本活动没有已核实的项目信息。' },
  'mkt.facts.contextVersion': { en: 'Context v{version}', zh: '上下文 v{version}' },

  // media
  'mkt.media.unavailable': {
    en: 'Media preview unavailable — secure delivery not connected yet.',
    zh: '素材预览不可用——安全分发尚未接通。',
  },
  'mkt.media.safety': { en: 'Safety', zh: '安全审核' },
  'mkt.media.state': { en: 'State', zh: '状态' },
  'mkt.media.none': { en: 'No media is attached to this campaign.', zh: '本活动未附加素材。' },

  // channel previews
  'mkt.preview.headline': { en: 'Headline', zh: '标题' },
  'mkt.preview.hook': { en: 'Hook', zh: '开场' },
  'mkt.preview.body': { en: 'Post copy', zh: '正文' },
  'mkt.preview.caption': { en: 'Caption', zh: '配文' },
  'mkt.preview.bodyDraft': { en: 'Body draft', zh: '正文草稿' },
  'mkt.preview.angle': { en: 'Professional angle', zh: '专业角度' },
  'mkt.preview.title': { en: 'Title', zh: '标题' },
  'mkt.preview.seoTitle': { en: 'SEO title', zh: 'SEO 标题' },
  'mkt.preview.metaDescription': { en: 'Meta description', zh: 'Meta 描述' },
  'mkt.preview.slug': { en: 'Proposed slug', zh: '建议 slug' },
  'mkt.preview.queryConcept': { en: 'Primary query concept', zh: '主要搜索概念' },
  'mkt.preview.secondaryConcepts': { en: 'Secondary concepts', zh: '次要概念' },
  'mkt.preview.contentType': { en: 'Content type', zh: '内容类型' },
  'mkt.preview.postType': { en: 'Post type', zh: '帖子类型' },
  'mkt.preview.format': { en: 'Format', zh: '形式' },
  'mkt.preview.serviceArea': { en: 'Authorized service area', zh: '授权服务区域' },
  'mkt.preview.geographicRelevance': { en: 'Verified geographic relevance', zh: '已核实的地域相关性' },
  'mkt.preview.localContext': { en: 'Local context', zh: '本地信息' },
  'mkt.preview.mediaTreatment': { en: 'Media treatment', zh: '素材处理' },
  'mkt.preview.hashtags': { en: 'Hashtags', zh: '话题标签' },
  'mkt.preview.outline': { en: 'Outline', zh: '大纲' },
  'mkt.preview.overlayText': { en: 'Overlay text', zh: '画面文字' },
  'mkt.preview.shotOrder': { en: 'Shot order', zh: '镜头顺序' },
  'mkt.preview.cta': { en: 'Call to action', zh: '行动号召' },
  'mkt.preview.claims': { en: 'Claims', zh: '事实主张' },
  'mkt.preview.assets': { en: '{count} media selected', zh: '已选 {count} 个素材' },
  'mkt.preview.empty': { en: 'This channel has no renderable copy fields.', zh: '该渠道没有可展示的文案字段。' },
  'mkt.preview.none': { en: 'This revision has no channel previews.', zh: '该版本没有渠道预览。' },

  // revisions
  'mkt.revision.generated': { en: 'Generated', zh: '生成' },
  'mkt.revision.humanEdit': { en: 'Operator edit', zh: '人工编辑' },
  'mkt.revision.regenerated': { en: 'Regenerated', zh: '重新生成' },
  'mkt.revision.systemRepair': { en: 'System repair', zh: '系统修复' },
  'mkt.revision.changed': { en: 'Changed', zh: '变更' },

  // actions
  'mkt.action.requestChanges': { en: 'Request changes', zh: '提出修改' },
  'mkt.action.edit': { en: 'Edit copy', zh: '编辑文案' },
  'mkt.action.remove': { en: 'Remove channel', zh: '移除渠道' },
  'mkt.action.regenerate': { en: 'Regenerate', zh: '重新生成' },
  'mkt.action.replaceMedia': { en: 'Replace media', zh: '替换素材' },
  'mkt.action.replaceMediaDisabled': {
    en: 'Media replacement will be enabled when secure media browsing is connected.',
    zh: '安全素材浏览接通后才能启用素材替换。',
  },
  'mkt.action.approve': { en: 'Approve campaign', zh: '批准活动' },
  'mkt.action.reject': { en: 'Reject campaign', zh: '拒绝活动' },
  'mkt.action.cancel': { en: 'Cancel draft', zh: '取消草稿' },
  'mkt.action.confirm': { en: 'Confirm', zh: '确认' },
  'mkt.action.dismiss': { en: 'Close', zh: '关闭' },
  'mkt.action.working': { en: 'Working…', zh: '处理中…' },

  // approval gating
  'mkt.approve.blockedByBlockers': { en: 'Resolve the blockers before approving.', zh: '请先解决阻断项再批准。' },
  'mkt.approve.blockedHistorical': { en: 'Only the current revision can be approved.', zh: '只有当前版本可以批准。' },
  'mkt.approve.blockedNotOffered': { en: 'Approval is not available for this campaign right now.', zh: '当前该活动不可批准。' },
  'mkt.approve.blockedDecided': { en: 'This revision already has a decision.', zh: '该版本已有决定。' },

  // dialogs
  'mkt.dialog.requestChangesTitle': { en: 'Request changes', zh: '提出修改' },
  'mkt.dialog.requestChangesDesc': {
    en: 'Describe what should change. This records your request and creates no revision — the campaign is not approved.',
    zh: '说明需要修改的内容。这只会记录请求、不会创建新版本,也不代表批准。',
  },
  'mkt.dialog.requestChangesPlaceholder': {
    en: 'e.g. Make the Facebook copy shorter and lead with craftsmanship.',
    zh: '例如:把 Facebook 文案改短,并突出工艺。',
  },
  'mkt.dialog.editTitle': { en: 'Edit {platform} copy', zh: '编辑 {platform} 文案' },
  'mkt.dialog.editNotice': { en: 'Saving this edit creates Revision {number}.', zh: '保存本次编辑会创建第 {number} 版。' },
  'mkt.dialog.editSave': { en: 'Save as new revision', zh: '保存为新版本' },
  'mkt.dialog.editNoChanges': { en: 'Change at least one field.', zh: '请至少修改一个字段。' },
  'mkt.dialog.removeTitle': { en: 'Remove {platform}?', zh: '移除 {platform}?' },
  'mkt.dialog.removeDesc': {
    en: 'This creates Revision {number} without that channel. Earlier revisions stay in history.',
    zh: '这会创建不含该渠道的第 {number} 版,较早的版本仍保留在历史中。',
  },
  'mkt.dialog.regenerateTitle': { en: 'Regenerate {platform}?', zh: '重新生成 {platform}?' },
  'mkt.dialog.regenerateDesc': {
    en: 'The Marketing Agent rewrites this channel from the same strategy, creating Revision {number}. This is not approval.',
    zh: '营销 Agent 会按相同策略重写该渠道并创建第 {number} 版。这不是批准。',
  },
  'mkt.dialog.approveTitle': { en: 'Approve Revision {number}?', zh: '批准第 {number} 版?' },
  'mkt.dialog.approveChannels': { en: 'Channels being approved', zh: '将被批准的渠道' },
  'mkt.dialog.approveNotPublished': {
    en: 'Nothing will be published. Approval records the decision for this exact revision only.',
    zh: '不会发布任何内容。批准只记录针对该版本的决定。',
  },
  'mkt.dialog.rejectTitle': { en: 'Reject this campaign?', zh: '拒绝该活动?' },
  'mkt.dialog.rejectDesc': { en: 'The campaign is closed and its media is released.', zh: '活动将被关闭,其素材会被释放。' },
  'mkt.dialog.cancelTitle': { en: 'Cancel this draft?', zh: '取消该草稿?' },
  'mkt.dialog.cancelDesc': { en: 'The draft is cancelled and its media is released.', zh: '草稿将被取消,其素材会被释放。' },
  'mkt.dialog.reasonLabel': { en: 'Reason', zh: '原因' },
  'mkt.dialog.reasonPlaceholder': { en: 'Why?', zh: '原因是什么?' },
  'mkt.dialog.reasonRequired': { en: 'A reason is required.', zh: '必须填写原因。' },
  'mkt.dialog.instructionRequired': { en: 'An instruction is required.', zh: '必须填写修改说明。' },

  // results
  'mkt.result.approved': { en: 'Approved — ready for publication', zh: '已批准——可进入发布流程' },
  'mkt.result.approvedNotPublished': {
    en: 'Publishing is not enabled yet. Nothing has been posted or scheduled.',
    zh: '发布功能尚未启用,没有任何内容被发布或排期。',
  },
  'mkt.result.revisionCreated': { en: 'Revision {number} created.', zh: '已创建第 {number} 版。' },
  'mkt.result.changesRequested': {
    en: 'Change request recorded. The campaign is still awaiting review.',
    zh: '修改请求已记录,活动仍在待审阅状态。',
  },
  'mkt.result.rejected': { en: 'Campaign rejected.', zh: '活动已拒绝。' },
  'mkt.result.cancelled': { en: 'Draft cancelled.', zh: '草稿已取消。' },

  // errors
  'mkt.error.revisionStale': {
    en: 'A newer revision exists. The campaign has been refreshed.',
    zh: '已有更新的版本,活动已刷新。',
  },
  'mkt.error.approvalBlocked': { en: 'This revision cannot be approved yet.', zh: '该版本暂时无法批准。' },
  'mkt.error.contextChanged': {
    en: 'Verified project information changed. Review the updated campaign before approval.',
    zh: '已核实的项目信息发生变化,请先复核更新后的活动再批准。',
  },
  'mkt.error.mediaConflict': {
    en: 'That media is no longer available for this campaign.',
    zh: '该素材已不能用于此活动。',
  },
  'mkt.error.campaignFinal': { en: 'This campaign already has a final decision.', zh: '该活动已有最终决定。' },
  'mkt.error.invalidEdit': { en: 'That edit was rejected. Check the fields and try again.', zh: '该编辑被拒绝,请检查字段后重试。' },
  'mkt.error.invalidRequest': { en: 'That request was incomplete.', zh: '请求内容不完整。' },
  'mkt.error.invalidAction': { en: 'That action is not available right now.', zh: '当前无法执行该操作。' },
  'mkt.error.notFound': { en: 'That campaign or revision no longer exists.', zh: '该活动或版本已不存在。' },
  'mkt.error.unauthorized': { en: 'Your JusticeOS session is no longer valid.', zh: 'JusticeOS 登录状态已失效。' },
  'mkt.error.unavailable': {
    en: 'Marketing Agent is temporarily unavailable. JusticeOS chat is unaffected.',
    zh: '营销 Agent 暂时不可用,不影响 JusticeOS 聊天。',
  },
  'mkt.error.notConfigured': {
    en: 'The Marketing Agent integration is not configured on this JusticeOS gateway.',
    zh: '此 JusticeOS 网关尚未配置营销 Agent 集成。',
  },
  'mkt.error.actorNotConfigured': {
    en: 'This gateway has no operator identity configured, so changes cannot be recorded.',
    zh: '此网关未配置操作者身份,无法记录变更。',
  },
  'mkt.error.generic': { en: 'Something went wrong. Nothing was changed.', zh: '出现问题,未作任何更改。' },

  // integration status
  'mkt.status.reachable': { en: 'Marketing Agent connected', zh: '营销 Agent 已连接' },
  'mkt.status.unreachable': { en: 'Marketing Agent unavailable', zh: '营销 Agent 不可用' },
  'mkt.status.notConfigured': { en: 'Marketing Agent not configured', zh: '营销 Agent 未配置' },
  'mkt.status.chatUnaffected': { en: 'JusticeOS chat is unaffected.', zh: '不影响 JusticeOS 聊天。' },
} as const;

export type MessageKey = keyof typeof messages;
