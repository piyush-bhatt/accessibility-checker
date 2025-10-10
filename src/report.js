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
  // Safety check
  if (!element) {
    return {
      tagName: 'unknown',
      id: '',
      trackId: '',
      dataTestId: '',
      className: '',
      innerText: '',
      position: 'N/A',
      size: 'N/A',
    };
  }

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

  // Safely get tagName
  let tagName = 'unknown';
  try {
    tagName = element.tagName ? element.tagName.toLowerCase() : 'unknown';
  } catch (e) {
    tagName = 'unknown';
  }

  // Safely get attributes
  let id = '';
  let trackId = '';
  let dataTestId = '';
  let className = '';
  try {
    id = element.id || '';
    trackId = element.getAttribute('trackid') || '';
    dataTestId = element.getAttribute('data-testid') || '';
    className = element.className || '';
  } catch (e) {
    // Attributes may fail on detached elements
  }

  return {
    tagName: tagName,
    id: id,
    trackId: trackId,
    dataTestId: dataTestId,
    className: className,
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

  console.log('[storeErrorsInReport] Starting to store errors:', {
    flowName,
    pageName,
    errorCount: errors.length,
  });

  // Get existing report from storage
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['auditReport'], function (data) {
      try {
        const report = data.auditReport || {};

        // Initialize flow if not exists
        if (!report[flowName]) {
          report[flowName] = {};
        }

        // Initialize page object if not exists, or clear if re-running on same page
        // Store page timestamp and errors array
        const pageTimestamp = new Date().toISOString();

        // Create array to hold all errors for this page
        const pageErrors = [];

        // Add each error to the array
        errors.forEach((error, index) => {
          try {
            const details = getElementDetails(error.element);
            const errorCode = getErrorCode(error.message);
            const screenshot = error.screenshot || null;
            const html = error.html || '';
            const parentHTML = error.parentHTML || '';

            pageErrors.push({
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
              // HTML context for debugging
              html: html,
              parentHTML: parentHTML,
            });
          } catch (err) {
            console.error(
              `[storeErrorsInReport] Error processing error ${index}:`,
              err
            );
            // Continue with other errors even if one fails
          }
        });

        console.log(
          '[storeErrorsInReport] Processed errors:',
          pageErrors.length
        );

        // Only update the report after all errors are processed
        report[flowName][pageName] = {
          pageTimestamp: pageTimestamp,
          errors: pageErrors,
        };

        // Check size of data before saving
        const reportStr = JSON.stringify(report);
        const sizeInBytes = new Blob([reportStr]).size;
        const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);
        console.log(`[storeErrorsInReport] Report size: ${sizeInMB} MB`);

        // Chrome storage.local has a limit of ~5MB
        // Progressive strategy to fit data
        if (sizeInBytes > 4.8 * 1024 * 1024) {
          console.warn(
            '[storeErrorsInReport] Report too large (>4.8MB), removing all screenshots...'
          );
          // Remove all screenshots
          pageErrors.forEach((error) => {
            error.screenshot = null;
          });
          report[flowName][pageName].errors = pageErrors;
        } else if (sizeInBytes > 4.5 * 1024 * 1024) {
          console.warn(
            '[storeErrorsInReport] Report large (>4.5MB), removing 50% of screenshots...'
          );
          // Remove every other screenshot
          pageErrors.forEach((error, index) => {
            if (index % 2 === 1) {
              error.screenshot = null;
            }
          });
          report[flowName][pageName].errors = pageErrors;
        }

        // Save updated report
        chrome.storage.local.set({ auditReport: report }, function () {
          if (chrome.runtime.lastError) {
            console.error(
              '[storeErrorsInReport] Error saving to storage:',
              chrome.runtime.lastError
            );
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log(
              '[storeErrorsInReport] Report saved successfully. Total errors:',
              pageErrors.length
            );
            resolve({ success: true, errorCount: pageErrors.length });
          }
        });
      } catch (err) {
        console.error('[storeErrorsInReport] Error in processing:', err);
        reject(err);
      }
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
