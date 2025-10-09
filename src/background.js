// ===== BACKGROUND SERVICE WORKER =====
// Maintains the active flow state and detects page changes
// Works independently of the popup (which closes when losing focus)

console.log('Background service worker loaded');

// Track the last analyzed URL per tab to avoid duplicate analyses
const lastAnalyzedUrls = new Map();

// Listen for tab updates (including URL changes)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only proceed when the page has finished loading and URL has changed
  if (changeInfo.status === 'complete' && tab.url) {
    console.log(`Tab ${tabId} updated:`, tab.url);

    // Check if there's an active flow
    const result = await chrome.storage.local.get([
      'isFlowActive',
      'activeFlow',
      'divClass',
      'options',
    ]);

    if (!result.isFlowActive || !result.activeFlow) {
      console.log('No active flow, skipping auto-analysis');
      return;
    }

    // Check if we already analyzed this URL for this tab
    const lastUrl = lastAnalyzedUrls.get(tabId);
    if (lastUrl === tab.url) {
      console.log('Already analyzed this URL, skipping');
      return;
    }

    // Update the last analyzed URL
    lastAnalyzedUrls.set(tabId, tab.url);

    console.log(`Active flow detected: "${result.activeFlow}"`);
    console.log('Auto-analyzing page...');

    // Wait a bit for the page to fully render
    setTimeout(async () => {
      try {
        // Inject scripts dynamically before analysis
        try {
          await chrome.scripting.insertCSS({
            target: { tabId: tabId },
            files: ['styles/content.css'],
          });

          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['src/report.js', 'src/content.js'],
          });

          console.log('Scripts injected successfully');
        } catch (injectionError) {
          console.log(
            'Scripts may already be injected, continuing...',
            injectionError
          );
        }

        // Small delay to ensure scripts are loaded
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Send message to content script to run analysis
        const response = await chrome.tabs.sendMessage(tabId, {
          action: 'runAudit',
          divClass: result.divClass,
          options: result.options,
          flowName: result.activeFlow,
        });

        if (response && response.success) {
          console.log(
            `✅ Auto-analysis complete: ${response.errorCount} errors found`
          );

          // Show notification (optional)
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'Page Analyzed',
            message: `Flow "${result.activeFlow}": ${response.errorCount} issue(s) found`,
            priority: 1,
          });
        } else if (response && response.error) {
          console.error('Analysis error:', response.error);
        }
      } catch (error) {
        console.error('Error sending message to content script:', error);
        // Content script might not be loaded yet, ignore
      }
    }, 1500); // Wait 1.5 seconds for page to render
  }
});

// Listen for tab removal (cleanup)
chrome.tabs.onRemoved.addListener((tabId) => {
  lastAnalyzedUrls.delete(tabId);
  console.log(`Tab ${tabId} removed, cleaned up tracking`);
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'flowStarted') {
    console.log('Flow started:', request.flowName);
    // Reset tracking when flow starts
    lastAnalyzedUrls.clear();
    sendResponse({ success: true });
  } else if (request.action === 'flowFinished') {
    console.log('Flow finished');
    // Clear tracking when flow ends
    lastAnalyzedUrls.clear();
    sendResponse({ success: true });
  } else if (request.action === 'captureVisibleTab') {
    // Capture screenshot of visible tab (full page)
    (async () => {
      try {
        // Capture the visible tab
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
          format: 'png',
          quality: 90,
        });

        sendResponse({ dataUrl: dataUrl });
      } catch (error) {
        console.error('Error capturing visible tab:', error);
        sendResponse({ dataUrl: null });
      }
    })();
    return true; // Keep message channel open
  }
  return true;
});

console.log('Background service worker ready');
