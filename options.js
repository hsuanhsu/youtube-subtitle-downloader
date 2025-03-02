// 設定選項的預設值
const defaultOptions = {
  defaultFormat: 'srt',
  defaultLanguage: 'auto',
  includeAutoSubs: true
};

// DOM 元素
const elements = {
  defaultFormat: document.getElementById('default-format'),
  defaultLanguage: document.getElementById('default-language'),
  includeAutoSubs: document.getElementById('include-auto-subs'),
  saveButton: document.getElementById('save-btn'),
  resetButton: document.getElementById('reset-btn'),
  status: document.getElementById('status')
};

// 當頁面載入時，載入已保存的設定
document.addEventListener('DOMContentLoaded', loadOptions);

// 儲存按鈕點擊事件
elements.saveButton.addEventListener('click', saveOptions);

// 重置按鈕點擊事件
elements.resetButton.addEventListener('click', resetOptions);

// 載入設定
async function loadOptions() {
  try {
    const options = await chrome.storage.sync.get(defaultOptions);
    
    // 填充表單
    elements.defaultFormat.value = options.defaultFormat;
    elements.defaultLanguage.value = options.defaultLanguage;
    elements.includeAutoSubs.checked = options.includeAutoSubs;
  } catch (error) {
    showStatus('載入設定時發生錯誤', true);
    console.error('載入設定錯誤:', error);
  }
}

// 儲存設定
async function saveOptions() {
  try {
    // 收集表單數據
    const options = {
      defaultFormat: elements.defaultFormat.value,
      defaultLanguage: elements.defaultLanguage.value,
      includeAutoSubs: elements.includeAutoSubs.checked
    };
    
    // 儲存到 chrome.storage
    console.log('正在儲存設定:', options);
    await chrome.storage.sync.set(options);
    
    // 顯示成功訊息
    showStatus('設定已儲存');
    console.log('設定儲存成功，已發送更新通知');
    
    // 通知其他部分設定已更新
    chrome.runtime.sendMessage({
      action: 'optionsUpdated',
      options: options
    });
  } catch (error) {
    showStatus('儲存設定時發生錯誤', true);
    console.error('儲存設定錯誤:', error);
  }
}

// 重置為預設值
async function resetOptions() {
  try {
    // 清除所有已保存的設定
    await chrome.storage.sync.clear();
    
    // 重新載入預設值
    await loadOptions();
    
    // 通知其他部分設定已重置
    chrome.runtime.sendMessage({
      action: 'optionsUpdated',
      options: {
        ...defaultOptions,
        reset: true  // 標記這是重置操作
      }
    });
    
    // 顯示成功訊息
    showStatus('設定已重置為預設值');
    
    console.log('設定已重置為預設值:', defaultOptions);
  } catch (error) {
    showStatus('重置設定時發生錯誤', true);
    console.error('重置設定錯誤:', error);
  }
}

// 顯示狀態訊息
function showStatus(message, isError = false) {
  const status = elements.status;
  status.textContent = message;
  status.className = 'status show ' + (isError ? 'error' : 'success');
  
  // 3秒後隱藏訊息
  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}

// 監聽設定變更
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    // 重新載入設定
    loadOptions();
  }
});