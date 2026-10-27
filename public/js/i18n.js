// ================= 国际化（i18n）系统 =================

const translations = {
  zh: {
    // 通用
    'save': '保存',
    'cancel': '取消',
    'confirm': '确认',
    'delete': '删除',
    'edit': '编辑',
    'add': '添加',
    'search': '搜索',
    'loading': '加载中...',
    'success': '成功',
    'error': '错误',
    'close': '关闭',

    // 侧边栏
    'new_chat': '新建对话',
    'today': '今天',
    'yesterday': '昨天',
    'this_week': '本周',
    'earlier': '更早',

    // 顶部导航
    'projects': '项目',
    'experts': '专家·技能·连接器',
    'automation': '自动化',
    'library': '资料库',
    'settings': '设置',

    // 输入框
    'input_placeholder': '今天帮你做些什么？@ 引用文件，/ 调用技能与指令',
    'send': '发送',
    'stop': '停止',

    // 设置页面
    'settings_title': '⚙️ 设置',
    'models': '模型设置',
    'skills': '技能管理',
    'agent': '智能体设置',
    'context': '上下文设置',
    'persona': '个性化',
    'pet': '桌面宠物',
    'data': '数据管理',
  },

  en: {
    // Common
    'save': 'Save',
    'cancel': 'Cancel',
    'confirm': 'Confirm',
    'delete': 'Delete',
    'edit': 'Edit',
    'add': 'Add',
    'search': 'Search',
    'loading': 'Loading...',
    'success': 'Success',
    'error': 'Error',
    'close': 'Close',

    // Sidebar
    'new_chat': 'New Chat',
    'today': 'Today',
    'yesterday': 'Yesterday',
    'this_week': 'This Week',
    'earlier': 'Earlier',

    // Top Navigation
    'projects': 'Projects',
    'experts': 'Experts & Skills',
    'automation': 'Automation',
    'library': 'Library',
    'settings': 'Settings',

    // Input
    'input_placeholder': 'What can I help you with today? @ to reference files, / for skills',
    'send': 'Send',
    'stop': 'Stop',

    // Settings Page
    'settings_title': '⚙️ Settings',
    'models': 'Models',
    'skills': 'Skills',
    'agent': 'Agent',
    'context': 'Context',
    'persona': 'Personalization',
    'pet': 'Pet',
    'data': 'Data',
  }
};

// 获取当前语言
function getCurrentLanguage() {
  return localStorage.getItem('app_language') || 'zh';
}

// 翻译函数
function t(key) {
  const lang = getCurrentLanguage();
  return translations[lang]?.[key] || translations['zh']?.[key] || key;
}

// 暴露到全局
window.t = t;
window.getCurrentLanguage = getCurrentLanguage;

console.log('[i18n] 国际化系统已加载，当前语言:', getCurrentLanguage());
