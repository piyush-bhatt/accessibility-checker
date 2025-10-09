// ===== REPORT GENERATION MODULE =====
// This module handles error collection, storage, and report generation

/**
 * Extract flow name from URL query parameter 'applicationId'
 * @returns {string} Flow name or 'NEW QnB' as default
 */
function getFlowName() {
  const urlParams = new URLSearchParams(window.location.search);
  const applicationId = urlParams.get('applicationId');

  return applicationId || 'NEW QnB';
}

/**
 * Extract page name from URL hash or pathname
 * @returns {string} Page name extracted from URL
 */
function getPageName() {
  const url = window.location.href;

  // Try hash first (for Angular routes like #/vehicleSearch)
  if (url.includes('#/')) {
    const hashPart = url.split('#/')[1];
    if (hashPart) {
      // Remove query params if any
      const pageName = hashPart.split('?')[0].split('/')[0];
      return pageName || 'unknown';
    }
  }

  // Otherwise use pathname
  const pathname = window.location.pathname;
  const parts = pathname.split('/').filter((p) => p);
  return parts[parts.length - 1] || 'home';
}

/**
 * Extract element details (id, trackid, data-testid, className)
 * @param {HTMLElement} element - The element to extract details from
 * @returns {Object} Element details including visual context
 */
function getElementDetails(element) {
  // Get element text (trimmed, max 100 chars)
  let innerText = '';
  try {
    innerText = element.innerText || element.textContent || '';
    innerText = innerText.trim().substring(0, 100);
    if (innerText.length === 100) innerText += '...';
  } catch (e) {
    innerText = '';
  }

  // Get element position and size
  let position = '';
  let size = '';
  try {
    const rect = element.getBoundingClientRect();
    position = `x:${Math.round(rect.left)}, y:${Math.round(rect.top)}`;
    size = `${Math.round(rect.width)}x${Math.round(rect.height)}px`;
  } catch (e) {
    position = 'N/A';
    size = 'N/A';
  }

  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || '',
    trackId: element.getAttribute('trackid') || '',
    dataTestId: element.getAttribute('data-testid') || '',
    className: element.className || '',
    innerText: innerText,
    position: position,
    size: size,
  };
}

/**
 * Classify error by type and return unique code
 * @param {string} message - Error message
 * @returns {string} Error code (FONT-SIZE, ICON-SIZE, etc.)
 */
function getErrorCode(message) {
  if (message.includes('Text size too small')) {
    return 'FONT-SIZE';
  } else if (message.includes('Clickable element too small')) {
    return 'ICON-SIZE';
  } else if (message.includes('Low contrast')) {
    return 'CONTRAST';
  } else if (message.includes('Missing ARIA')) {
    return 'ARIA-LABEL';
  } else if (message.includes('Empty clickable element')) {
    return 'EMPTY-ELEMENT';
  }
  return 'UNKNOWN';
}

/**
 * Store errors in report structure organized by flow and page
 * @param {Array} errors - Array of error objects with element and message
 * @param {string} customFlowName - Optional custom flow name (for flow mode)
 */
async function storeErrorsInReport(errors, customFlowName = null) {
  const flowName = customFlowName || getFlowName();
  const pageName = getPageName();

  // Get existing report from storage
  return new Promise((resolve) => {
    chrome.storage.local.get(['auditReport'], function (data) {
      const report = data.auditReport || {};

      // Initialize flow if not exists
      if (!report[flowName]) {
        report[flowName] = {};
      }

      // Initialize page object if not exists, or clear if re-running on same page
      // Store page timestamp and errors array
      const pageTimestamp = new Date().toISOString();
      report[flowName][pageName] = {
        pageTimestamp: pageTimestamp,
        errors: [],
      };

      // Add each error to the report
      errors.forEach((error) => {
        const details = getElementDetails(error.element);
        const errorCode = getErrorCode(error.message);
        const screenshot = error.screenshot || null;

        report[flowName][pageName].errors.push({
          errorCode: errorCode,
          tagName: details.tagName,
          id: details.id,
          trackId: details.trackId,
          dataTestId: details.dataTestId,
          className: details.className,
          message: error.message,
          timestamp: new Date().toISOString(),
          screenshot: screenshot, // Base64 image data or null
          // Visual context for easier identification
          innerText: details.innerText,
          position: details.position,
          size: details.size,
        });
      });

      // Save updated report
      chrome.storage.local.set({ auditReport: report }, function () {
        console.log('Report saved successfully. Total errors:', errors.length);
        resolve({ success: true, errorCount: errors.length });
      });
    });
  });
}

/**
 * Get the full report from storage
 * @param {Function} callback - Callback function that receives the report
 */
function getReport(callback) {
  chrome.storage.local.get(['auditReport'], function (data) {
    callback(data.auditReport || {});
  });
}

/**
 * Clear all report data from storage
 * @param {Function} callback - Callback function called after clearing
 */
function clearReport(callback) {
  chrome.storage.local.remove(['auditReport'], function () {
    if (callback) {
      callback({ success: true });
    }
  });
}

// Export functions for use in other scripts (if using modules)
// Or they will be available globally when script is loaded
