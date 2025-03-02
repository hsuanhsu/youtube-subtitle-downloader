// 監聽來自popup.js和options.js的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('收到消息:', request);

  if (request.action === 'optionsUpdated') {
    console.log('設定已更新:', request.options);
    // 只通知 YouTube 頁面更新設定
    chrome.tabs.query({
      url: "*://*.youtube.com/*"
    }, (tabs) => {
      console.log('找到的 YouTube 標籤頁:', tabs.length);
      tabs.forEach(tab => {
        if (tab.url.includes('youtube.com/watch')) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'settingsChanged',
            options: request.options
          }).catch(err => {
            // 忽略 "Receiving end does not exist" 錯誤
            if (!err.message.includes('Receiving end does not exist')) {
              console.error('通知標籤頁更新設定失敗:', err);
            }
          });
        }
      });
    });
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'downloadSubtitle') {
    handleSubtitleDownload(request.payload)
      .then(sendResponse)
      .catch(error => {
        console.error('下載字幕時發生錯誤:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 表示會異步發送回應
  }
});

// 處理字幕下載
// 監聽下載狀態的輔助函數
function createDownloadPromise(downloadId, filename, timeout) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      reject(new Error('下載超時，請檢查網路連線'));
    }, timeout);

    function listener(delta) {
      if (delta.id !== downloadId) return;

      if (delta.state?.current === 'complete') {
        clearTimeout(timeoutId);
        chrome.downloads.onChanged.removeListener(listener);
        resolve({ success: true, filename });
      } else if (delta.error) {
        clearTimeout(timeoutId);
        chrome.downloads.onChanged.removeListener(listener);
        const errors = {
          FILE_FAILED: '檔案建立失敗，請確認磁碟空間和權限',
          NETWORK_FAILED: '網路連線失敗，請檢查網路狀態',
          USER_CANCELED: '下載已被取消',
          FILESYSTEM_ERROR: '檔案系統錯誤，請確認儲存位置是否可寫入'
        };
        reject(new Error(errors[delta.error.current] || `下載失敗: ${delta.error.current}`));
      } else if (delta.state?.current === 'interrupted') {
        clearTimeout(timeoutId);
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error('下載被中斷'));
      }
    }

    chrome.downloads.onChanged.addListener(listener);
  });
}

// 主要下載處理函數
async function handleSubtitleDownload({ videoId, languageCode, baseUrl, format }) {
  const maxRetries = 3;
  const retryDelay = 2000;
  const downloadTimeout = 60000;
  let lastError = null;
  let url;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      console.log('開始下載字幕數據:', baseUrl);
      const subtitleData = await fetchSubtitleData(baseUrl);
      console.log('成功獲取字幕數據');
      
      console.log('開始獲取影片標題');
      const videoTitle = await fetchVideoTitle(videoId);
      console.log('影片標題:', videoTitle);
      
      console.log('開始轉換字幕格式:', format);
      const convertedSubtitles = convertSubtitleFormat(subtitleData, format);
      console.log('字幕轉換完成，長度:', convertedSubtitles.length);

      if (!convertedSubtitles.trim()) {
        console.error('轉換後的字幕內容為空');
        throw new Error('轉換後的字幕內容為空');
      }

      const filename = `${sanitizeFilename(videoTitle)}_${languageCode}.${format}`;
      console.log('準備開始下載，檔名:', filename);
      
      // 根據不同格式使用對應的 MIME type
      const mimeTypes = {
        srt: 'application/x-subrip',
        vtt: 'text/vtt',
        txt: 'text/plain'
      };
      const mimeType = mimeTypes[format.toLowerCase()] || 'text/plain';
      const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(convertedSubtitles)}`;
      
      try {
        const downloadId = await chrome.downloads.download({
          url: dataUrl,
          filename,
          saveAs: false
        });
        
        console.log('下載已開始，downloadId:', downloadId);

        try {
          const result = await createDownloadPromise(downloadId, filename, downloadTimeout);
          console.log('下載完成:', result);
          return result;
        } catch (downloadError) {
          console.error('下載過程發生錯誤:', downloadError);
          throw downloadError;
        }
      } catch (error) {
        console.error('啟動下載時發生錯誤:', error);
        throw new Error(`無法啟動下載: ${error.message}`);
      }
    } catch (error) {
      console.error(`下載嘗試 ${i + 1}/${maxRetries + 1} 失敗:`, error);
      lastError = error;

      if (i === maxRetries) {
        throw new Error(`下載失敗 (重試${maxRetries}次後): ${error.message}`);
      }

      await new Promise(r => setTimeout(r, retryDelay));
    }
  }
}

// 從YouTube獲取字幕資料
async function fetchSubtitleData(baseUrl) {
  try {
    // 確保有完整的 URL
    const fullUrl = baseUrl.startsWith('http')
      ? baseUrl
      : `https://www.youtube.com${baseUrl}`;
    
    // 添加必要的參數到URL
    const url = new URL(fullUrl);
    url.searchParams.set('fmt', 'json3');
    
    // 設定 fetch 選項，包含超時處理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超時

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('字幕資源不存在，請確認影片是否有字幕');
      } else if (response.status === 403) {
        throw new Error('無權限存取字幕，請確認影片是否可公開觀看');
      }
      throw new Error(`無法獲取字幕資料 (HTTP ${response.status})`);
    }
    
    const data = await response.json();
    if (!data || !data.events || data.events.length === 0) {
      throw new Error('沒有找到可用的字幕內容');
    }
    
    // 驗證字幕數據格式
    if (!data.events.every(event =>
      typeof event.tStartMs === 'number' &&
      (typeof event.segs === 'undefined' || Array.isArray(event.segs)))) {
      throw new Error('字幕格式異常，請重新嘗試');
    }
    
    return data;
  } catch (error) {
    console.error('獲取字幕資料時發生錯誤:', error);
    if (error.name === 'AbortError') {
      throw new Error('請求超時，請檢查網路連線並重試');
    } else if (error.name === 'TypeError') {
      throw new Error('網路連線失敗，請確認網路狀態');
    } else if (error.message.includes('無法獲取字幕資料')) {
      throw new Error('無法取得字幕，請確認影片是否有字幕');
    }
    throw error; // 保留原始錯誤訊息以便更好地診斷問題
  }
}

// 獲取影片標題
async function fetchVideoTitle(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
  const html = await response.text();
  
  // 從HTML中提取標題
  const titleMatch = html.match(/<title>(.+?)<\/title>/);
  if (titleMatch) {
    return titleMatch[1].replace(' - YouTube', '').trim();
  }
  
  return videoId; // 如果無法獲取標題，則使用影片ID
}

// 轉換字幕格式
function convertSubtitleFormat(subtitleData, targetFormat) {
  const events = subtitleData.events || [];
  
  // 將字幕資料轉換為通用格式
  const subtitles = events.map(event => ({
    start: event.tStartMs / 1000,
    duration: (event.dDurationMs || 0) / 1000,
    text: event.segs ? event.segs.map(seg => seg.utf8).join('') : ''
  })).filter(sub => sub.text.trim()); // 移除空白字幕
  
  // 根據目標格式進行轉換
  switch (targetFormat.toLowerCase()) {
    case 'srt':
      return convertToSRT(subtitles);
    case 'vtt':
      return convertToVTT(subtitles);
    case 'txt':
      return convertToTXT(subtitles);
    default:
      throw new Error('不支援的字幕格式');
  }
}

// 轉換為SRT格式
function convertToSRT(subtitles) {
  return subtitles.map((sub, index) => {
    const startTime = formatSRTTime(sub.start);
    const endTime = formatSRTTime(sub.start + sub.duration);
    return `${index + 1}\n${startTime} --> ${endTime}\n${sub.text}\n`;
  }).join('\n');
}

// 轉換為WebVTT格式
function convertToVTT(subtitles) {
  const header = 'WEBVTT\n\n';
  const body = subtitles.map((sub, index) => {
    const startTime = formatVTTTime(sub.start);
    const endTime = formatVTTTime(sub.start + sub.duration);
    return `${startTime} --> ${endTime}\n${sub.text}\n`;
  }).join('\n');
  
  return header + body;
}

// 轉換為純文字格式
function convertToTXT(subtitles) {
  return subtitles.map(sub => sub.text).join('\n');
}

// 格式化SRT時間戳
function formatSRTTime(seconds) {
  const date = new Date(seconds * 1000);
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  
  return `${hours}:${minutes}:${secs},${ms}`;
}

// 格式化WebVTT時間戳
function formatVTTTime(seconds) {
  const date = new Date(seconds * 1000);
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  
  return `${hours}:${minutes}:${secs}.${ms}`;
}

// 清理檔案名稱（移除不合法字符）
function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_') // 替換Windows不允許的字符
    .replace(/\s+/g, '_') // 替換空白字符為底線
    .substring(0, 255); // 限制長度
}
