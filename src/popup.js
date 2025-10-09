document.addEventListener('DOMContentLoaded', function () {
  const divClassInput = document.getElementById('divClass');
  const runAnalysisBtn = document.getElementById('runAnalysis');
  const statusDiv = document.getElementById('status');

  // Flow controls
  const startFlowBtn = document.getElementById('startFlow');
  const addPageToFlowBtn = document.getElementById('addPageToFlow');
  const finishFlowBtn = document.getElementById('finishFlow');
  const flowStatusDiv = document.getElementById('flowStatus');

  // Advanced checks toggle
  const toggleAdvancedBtn = document.getElementById('toggleAdvanced');
  const advancedOptionsDiv = document.getElementById('advancedOptions');
  const toggleIcon = toggleAdvancedBtn.querySelector('.toggle-icon');

  let isFlowActive = false;
  let currentFlowName = '';

  const checkboxes = {
    fontSize: document.getElementById('checkFontSize'),
    iconSize: document.getElementById('checkIconSize'),
    contrast: document.getElementById('checkContrast'),
    borderContrast: document.getElementById('checkBorderContrast'),
    ariaLabel: document.getElementById('checkAriaLabel'),
    emptyElements: document.getElementById('checkEmptyElements'),
    // Advanced checks
    focusVisible: document.getElementById('checkFocusVisible'),
    tabOrder: document.getElementById('checkTabOrder'),
    altText: document.getElementById('checkAltText'),
    formLabels: document.getElementById('checkFormLabels'),
    headings: document.getElementById('checkHeadings'),
    keyboardTraps: document.getElementById('checkKeyboardTraps'),
    hiddenContent: document.getElementById('checkHiddenContent'),
    colorDependence: document.getElementById('checkColorDependence'),
    language: document.getElementById('checkLanguage'),
    linkText: document.getElementById('checkLinkText'),
  };

  // Toggle advanced options
  toggleAdvancedBtn.addEventListener('click', function () {
    const isExpanded = advancedOptionsDiv.style.display !== 'none';
    advancedOptionsDiv.style.display = isExpanded ? 'none' : 'block';
    toggleIcon.classList.toggle('expanded');
  });

  // Load saved state
  chrome.storage.local.get(['divClass', 'options'], function (result) {
    console.log('Loading saved state:', result);

    if (result.divClass) {
      divClassInput.value = result.divClass;
    }

    if (result.options) {
      checkboxes.fontSize.checked = result.options.fontSize !== false;
      checkboxes.iconSize.checked = result.options.iconSize !== false;
      checkboxes.contrast.checked = result.options.contrast !== false;
      checkboxes.borderContrast.checked =
        result.options.borderContrast !== false;
      checkboxes.ariaLabel.checked = result.options.ariaLabel !== false;
      checkboxes.emptyElements.checked = result.options.emptyElements === true; // Default false

      // Advanced checks - all default to false
      checkboxes.focusVisible.checked = result.options.focusVisible === true;
      checkboxes.tabOrder.checked = result.options.tabOrder === true;
      checkboxes.altText.checked = result.options.altText === true;
      checkboxes.formLabels.checked = result.options.formLabels === true;
      checkboxes.headings.checked = result.options.headings === true;
      checkboxes.keyboardTraps.checked = result.options.keyboardTraps === true;
      checkboxes.hiddenContent.checked = result.options.hiddenContent === true;
      checkboxes.colorDependence.checked =
        result.options.colorDependence === true;
      checkboxes.language.checked = result.options.language === true;
      checkboxes.linkText.checked = result.options.linkText === true;
    }
  });

  // Save state on change
  function saveState() {
    const options = {
      fontSize: checkboxes.fontSize.checked,
      iconSize: checkboxes.iconSize.checked,
      contrast: checkboxes.contrast.checked,
      borderContrast: checkboxes.borderContrast.checked,
      ariaLabel: checkboxes.ariaLabel.checked,
      emptyElements: checkboxes.emptyElements.checked,
      // Advanced checks
      focusVisible: checkboxes.focusVisible.checked,
      tabOrder: checkboxes.tabOrder.checked,
      altText: checkboxes.altText.checked,
      formLabels: checkboxes.formLabels.checked,
      headings: checkboxes.headings.checked,
      keyboardTraps: checkboxes.keyboardTraps.checked,
      hiddenContent: checkboxes.hiddenContent.checked,
      colorDependence: checkboxes.colorDependence.checked,
      language: checkboxes.language.checked,
      linkText: checkboxes.linkText.checked,
    };

    const dataToSave = {
      divClass: divClassInput.value,
      options: options,
    };

    chrome.storage.local.set(dataToSave, function () {
      if (chrome.runtime.lastError) {
        console.error('Error saving state:', chrome.runtime.lastError);
      } else {
        console.log('State saved:', dataToSave);
      }
    });
  }

  divClassInput.addEventListener('input', saveState);
  divClassInput.addEventListener('change', saveState); // Save on blur/change too
  Object.values(checkboxes).forEach((cb) =>
    cb.addEventListener('change', saveState)
  );

  // Save state before popup closes
  window.addEventListener('beforeunload', saveState);

  // Run analysis
  runAnalysisBtn.addEventListener('click', async function () {
    const divClass = divClassInput.value.trim();

    if (!divClass) {
      showStatus('Please enter a div class name', 'error');
      return;
    }

    const options = {
      fontSize: checkboxes.fontSize.checked,
      iconSize: checkboxes.iconSize.checked,
      contrast: checkboxes.contrast.checked,
      borderContrast: checkboxes.borderContrast.checked,
      ariaLabel: checkboxes.ariaLabel.checked,
      emptyElements: checkboxes.emptyElements.checked,
      // Advanced checks
      focusVisible: checkboxes.focusVisible.checked,
      tabOrder: checkboxes.tabOrder.checked,
      altText: checkboxes.altText.checked,
      formLabels: checkboxes.formLabels.checked,
      headings: checkboxes.headings.checked,
      keyboardTraps: checkboxes.keyboardTraps.checked,
      hiddenContent: checkboxes.hiddenContent.checked,
      colorDependence: checkboxes.colorDependence.checked,
      language: checkboxes.language.checked,
      linkText: checkboxes.linkText.checked,
    };

    // Check if at least one option is selected
    if (!Object.values(options).some((v) => v)) {
      showStatus('Please enable at least one audit option', 'error');
      return;
    }

    runAnalysisBtn.disabled = true;
    showStatus('Running analysis...', 'info');

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      // Inject scripts dynamically into the current tab
      try {
        // Inject CSS first
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['styles/content.css'],
        });

        // Inject JavaScript files
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/report.js', 'src/content.js'],
        });
      } catch (injectionError) {
        console.log(
          'Scripts may already be injected, continuing...',
          injectionError
        );
      }

      // Small delay to ensure scripts are loaded
      await new Promise((resolve) => setTimeout(resolve, 100));

      await chrome.tabs.sendMessage(
        tab.id,
        {
          action: 'runAudit',
          divClass: divClass,
          options: options,
        },
        function (response) {
          runAnalysisBtn.disabled = false;

          if (chrome.runtime.lastError) {
            showStatus('Error: Please refresh the page and try again', 'error');
            return;
          }

          if (response && response.success) {
            showStatus(
              `Analysis complete! Found ${response.errorCount} issue(s)`,
              'success'
            );
          } else if (response && response.error) {
            showStatus(response.error, 'error');
          }
        }
      );
    } catch (error) {
      runAnalysisBtn.disabled = false;
      showStatus('Error: ' + error.message, 'error');
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = 'status-message ' + type;

    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        statusDiv.className = 'status-message';
      }, 5000);
    }
  }

  // ===== FLOW MANAGEMENT =====

  // Function to analyze current page (reusable)
  async function analyzeCurrentPage() {
    if (!isFlowActive) {
      showStatus('No active flow. Start a flow first.', 'error');
      return;
    }

    const divClass = divClassInput.value.trim();

    if (!divClass) {
      showStatus('Please enter a div class name', 'error');
      return;
    }

    const options = {
      fontSize: checkboxes.fontSize.checked,
      iconSize: checkboxes.iconSize.checked,
      contrast: checkboxes.contrast.checked,
      borderContrast: checkboxes.borderContrast.checked,
      ariaLabel: checkboxes.ariaLabel.checked,
      emptyElements: checkboxes.emptyElements.checked,
      // Advanced checks
      focusVisible: checkboxes.focusVisible.checked,
      tabOrder: checkboxes.tabOrder.checked,
      altText: checkboxes.altText.checked,
      formLabels: checkboxes.formLabels.checked,
      headings: checkboxes.headings.checked,
      keyboardTraps: checkboxes.keyboardTraps.checked,
      hiddenContent: checkboxes.hiddenContent.checked,
      colorDependence: checkboxes.colorDependence.checked,
      language: checkboxes.language.checked,
      linkText: checkboxes.linkText.checked,
    };

    if (!Object.values(options).some((v) => v)) {
      showStatus('Please enable at least one audit option', 'error');
      return;
    }

    addPageToFlowBtn.disabled = true;
    showStatus('Analyzing page and adding to flow...', 'info');

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      // Inject scripts dynamically
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['styles/content.css'],
        });

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/report.js', 'src/content.js'],
        });
      } catch (injectionError) {
        console.log(
          'Scripts may already be injected, continuing...',
          injectionError
        );
      }

      // Small delay to ensure scripts are loaded
      await new Promise((resolve) => setTimeout(resolve, 100));

      await chrome.tabs.sendMessage(
        tab.id,
        {
          action: 'runAudit',
          divClass: divClass,
          options: options,
          flowName: currentFlowName,
        },
        function (response) {
          addPageToFlowBtn.disabled = false;

          if (chrome.runtime.lastError) {
            showStatus('Error: Please refresh the page and try again', 'error');
            return;
          }

          if (response && response.success) {
            showStatus(
              `Page analyzed! Found ${response.errorCount} issue(s)`,
              'success'
            );

            // Update flow status
            chrome.storage.local.get(['auditReport'], function (data) {
              const report = data.auditReport || {};
              const flowPages = report[currentFlowName] || {};
              const pageCount = Object.keys(flowPages).length;

              flowStatusDiv.textContent = `🎬 Flow: "${currentFlowName}" - ${pageCount} page(s) analyzed`;
            });
          } else if (response && response.error) {
            showStatus(response.error, 'error');
          }
        }
      );
    } catch (error) {
      addPageToFlowBtn.disabled = false;
      showStatus('Error: ' + error.message, 'error');
    }
  }

  // Start a new flow
  startFlowBtn.addEventListener('click', async function () {
    const flowName = prompt(
      'Enter a name for this flow:',
      'Flow ' + new Date().toLocaleString()
    );

    if (!flowName || !flowName.trim()) {
      showStatus('Flow name cannot be empty', 'error');
      return;
    }

    currentFlowName = flowName.trim();
    isFlowActive = true;

    // Get current config
    const divClass = divClassInput.value.trim();
    const options = {
      fontSize: checkboxes.fontSize.checked,
      iconSize: checkboxes.iconSize.checked,
      contrast: checkboxes.contrast.checked,
      borderContrast: checkboxes.borderContrast.checked,
      ariaLabel: checkboxes.ariaLabel.checked,
      emptyElements: checkboxes.emptyElements.checked,
      // Advanced checks
      focusVisible: checkboxes.focusVisible.checked,
      tabOrder: checkboxes.tabOrder.checked,
      altText: checkboxes.altText.checked,
      formLabels: checkboxes.formLabels.checked,
      headings: checkboxes.headings.checked,
      keyboardTraps: checkboxes.keyboardTraps.checked,
      hiddenContent: checkboxes.hiddenContent.checked,
      colorDependence: checkboxes.colorDependence.checked,
      language: checkboxes.language.checked,
      linkText: checkboxes.linkText.checked,
    };

    // Save flow state + config for background service worker
    chrome.storage.local.set({
      activeFlow: currentFlowName,
      isFlowActive: true,
      divClass: divClass,
      options: options,
    });

    // Notify background service worker
    chrome.runtime.sendMessage({
      action: 'flowStarted',
      flowName: currentFlowName,
    });

    // Update UI
    startFlowBtn.style.display = 'none';
    addPageToFlowBtn.style.display = 'block';
    finishFlowBtn.style.display = 'block';
    runAnalysisBtn.disabled = true;

    flowStatusDiv.style.display = 'block';
    flowStatusDiv.textContent = `🎬 Flow active: "${currentFlowName}" - Analyzing first page...`;

    showStatus(
      `Flow "${currentFlowName}" started! Analyzing current page...`,
      'info'
    );

    // Automatically analyze the first page
    await analyzeCurrentPage();
  });

  // Add current page to flow
  addPageToFlowBtn.addEventListener('click', async function () {
    await analyzeCurrentPage();
  });

  // Finish flow
  finishFlowBtn.addEventListener('click', function () {
    if (!isFlowActive) {
      return;
    }

    chrome.storage.local.get(['auditReport'], function (data) {
      const report = data.auditReport || {};
      const flowPages = report[currentFlowName] || {};
      const pageCount = Object.keys(flowPages).length;

      if (pageCount === 0) {
        if (
          !confirm(
            'This flow has no pages analyzed. Do you want to finish it anyway?'
          )
        ) {
          return;
        }
      }

      isFlowActive = false;
      currentFlowName = '';

      // Clear flow state
      chrome.storage.local.set({
        activeFlow: null,
        isFlowActive: false,
      });

      // Notify background service worker
      chrome.runtime.sendMessage({
        action: 'flowFinished',
      });

      // Update UI
      startFlowBtn.style.display = 'block';
      addPageToFlowBtn.style.display = 'none';
      finishFlowBtn.style.display = 'none';
      runAnalysisBtn.disabled = false;

      flowStatusDiv.style.display = 'none';

      showStatus(`Flow finished with ${pageCount} page(s)`, 'success');

      // Refresh report summary
      setTimeout(() => loadReportSummary(), 500);
    });
  });

  // Restore flow state on popup open
  chrome.storage.local.get(['activeFlow', 'isFlowActive'], function (result) {
    if (result.isFlowActive && result.activeFlow) {
      currentFlowName = result.activeFlow;
      isFlowActive = true;

      startFlowBtn.style.display = 'none';
      addPageToFlowBtn.style.display = 'block';
      finishFlowBtn.style.display = 'block';
      runAnalysisBtn.disabled = true;

      chrome.storage.local.get(['auditReport'], function (data) {
        const report = data.auditReport || {};
        const flowPages = report[currentFlowName] || {};
        const pageCount = Object.keys(flowPages).length;

        flowStatusDiv.style.display = 'block';
        flowStatusDiv.textContent = `🎬 Flow: "${currentFlowName}" - ${pageCount} page(s) analyzed`;
      });
    }
  });

  // ===== REPORT MANAGEMENT =====
  const reportSummary = document.getElementById('reportSummary');
  const reportTable = document.getElementById('reportTable');
  const reportTableBody = document.getElementById('reportTableBody');
  const downloadReportBtn = document.getElementById('downloadReport');
  const clearReportBtn = document.getElementById('clearReport');

  // Load and display report summary on popup load
  loadReportSummary();

  // Download report as CSV/Excel
  downloadReportBtn.addEventListener('click', async function () {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      chrome.tabs.sendMessage(
        tab.id,
        { action: 'getReport' },
        function (report) {
          if (
            chrome.runtime.lastError ||
            !report ||
            Object.keys(report).length === 0
          ) {
            showStatus('No report data to download', 'error');
            return;
          }

          generateExcelFile(report);
          showStatus('Report downloaded successfully!', 'success');
        }
      );
    } catch (error) {
      showStatus('Error downloading report: ' + error.message, 'error');
    }
  });

  // Download HTML report with screenshots
  const downloadHtmlReportBtn = document.getElementById('downloadHtmlReport');
  downloadHtmlReportBtn.addEventListener('click', async function () {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      chrome.tabs.sendMessage(
        tab.id,
        { action: 'getReport' },
        function (report) {
          if (
            chrome.runtime.lastError ||
            !report ||
            Object.keys(report).length === 0
          ) {
            showStatus('No report data to download', 'error');
            return;
          }

          generateHtmlReport(report);
          showStatus('HTML report with screenshots downloaded!', 'success');
        }
      );
    } catch (error) {
      showStatus('Error downloading HTML report: ' + error.message, 'error');
    }
  });

  // Clear report data
  clearReportBtn.addEventListener('click', function () {
    if (
      !confirm(
        'Are you sure you want to clear all report data? This cannot be undone.'
      )
    ) {
      return;
    }

    // Clear report directly from popup (no need to communicate with content script)
    chrome.storage.local.remove(['auditReport'], function () {
      loadReportSummary();
      reportTable.style.display = 'none';
      showStatus('Report data cleared', 'success');
    });
  });

  function loadReportSummary() {
    chrome.storage.local.get(['auditReport'], function (data) {
      const report = data.auditReport || {};
      const flowCount = Object.keys(report).length;

      let totalErrors = 0;
      let totalPages = 0;

      Object.values(report).forEach((flow) => {
        totalPages += Object.keys(flow).length;
        Object.values(flow).forEach((pageData) => {
          // Handle both old format (array) and new format (object with errors array)
          const errors = Array.isArray(pageData)
            ? pageData
            : pageData.errors || [];
          totalErrors += errors.length;
        });
      });

      if (flowCount === 0) {
        reportSummary.innerHTML =
          '<p class="summary-text">No errors collected yet. Run analysis to start.</p>';
        reportTable.style.display = 'none';
      } else {
        reportSummary.innerHTML = `
          <div class="summary-stats">
            <div class="stat-item">
              <span class="stat-label">Flows:</span>
              <span class="stat-value">${flowCount}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Pages:</span>
              <span class="stat-value">${totalPages}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Total Errors:</span>
              <span class="stat-value">${totalErrors}</span>
            </div>
          </div>
        `;
        // Always show details when there's data
        loadReportTable();
        reportTable.style.display = 'block';
      }
    });
  }

  function loadReportTable() {
    chrome.storage.local.get(['auditReport'], function (data) {
      const report = data.auditReport || {};

      reportTableBody.innerHTML = '';

      Object.entries(report).forEach(([flowName, pages]) => {
        Object.entries(pages).forEach(([pageName, pageData]) => {
          // Handle both old format (array) and new format (object with errors array)
          const errors = Array.isArray(pageData)
            ? pageData
            : pageData.errors || [];

          const row = document.createElement('tr');
          row.innerHTML = `
            <td>${flowName}</td>
            <td>${pageName}</td>
            <td>${errors.length}</td>
          `;
          reportTableBody.appendChild(row);
        });
      });
    });
  }

  function generateExcelFile(report) {
    // Generate CSV content with multiple sections (one per flow)
    let csvContent = '\uFEFF'; // UTF-8 BOM for Excel compatibility

    Object.entries(report).forEach(([flowName, pages]) => {
      // Add flow header
      csvContent += `\n=== FLOW: ${flowName} ===\n`;
      csvContent +=
        'FLOW NAME;PAGE NAME;ERROR CODE;ELEMENT TYPE;ID;TRACK ID;DATA-TEST-ID;CLASS;SIZE;POSITION;TEXT CONTENT;ERROR MESSAGE;SCREENSHOT\n';

      // Sort pages by timestamp (chronological order)
      const sortedPages = Object.entries(pages).sort((a, b) => {
        const timestampA = a[1].pageTimestamp || ''; // Handle old format without pageTimestamp
        const timestampB = b[1].pageTimestamp || '';
        return timestampA.localeCompare(timestampB);
      });

      sortedPages.forEach(([pageName, pageData]) => {
        // Handle both old format (array) and new format (object with errors array)
        const errors = Array.isArray(pageData)
          ? pageData
          : pageData.errors || [];

        errors.forEach((error) => {
          // Create visual context string
          const visualContext = [
            error.size || 'N/A',
            error.position || 'N/A',
            (error.innerText || '').substring(0, 50) || '(no text)',
          ];

          // Screenshot info (base64 would be too long for CSV, so we indicate if available)
          const screenshotInfo = error.screenshot
            ? 'Screenshot available (see HTML report)'
            : 'No screenshot';

          const row = [
            flowName,
            pageName,
            error.errorCode,
            error.tagName,
            error.id,
            error.trackId,
            error.dataTestId,
            error.className || '',
            ...visualContext,
            error.message,
            screenshotInfo,
          ]
            .map((cell) => `"${String(cell).replace(/"/g, '""')}"`) // Escape quotes
            .join(';');

          csvContent += row + '\n';
        });
      });

      csvContent += '\n'; // Empty line between flows
    });

    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, -5);
    link.setAttribute('href', url);
    link.setAttribute('download', `accessibility-report-${timestamp}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function generateHtmlReport(report) {
    // Generate HTML content with embedded screenshots
    let htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Accessibility Report with Screenshots</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }
        h2 {
            color: #34495e;
            margin-top: 30px;
            background: #ecf0f1;
            padding: 10px;
            border-left: 4px solid #3498db;
        }
        h3 {
            color: #7f8c8d;
            margin-top: 20px;
        }
        .error-card {
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 15px;
            margin: 15px 0;
            background: #fafafa;
            display: grid;
            grid-template-columns: 250px 1fr;
            gap: 20px;
        }
        .error-screenshot {
            text-align: center;
        }
        .error-screenshot img {
            max-width: 100%;
            max-height: 200px;
            width: auto;
            height: auto;
            border: 2px solid #e74c3c;
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            cursor: pointer;
            transition: transform 0.2s;
        }
        .error-screenshot img:hover {
            transform: scale(1.05);
        }
        .error-screenshot .no-image {
            width: 100%;
            height: 150px;
            background: #ecf0f1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #7f8c8d;
            border-radius: 4px;
            font-style: italic;
        }
        .error-screenshot-hint {
            font-size: 11px;
            color: #7f8c8d;
            margin-top: 5px;
            font-style: italic;
        }
        .error-details {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .error-code {
            display: inline-block;
            background: #e74c3c;
            color: white;
            padding: 4px 12px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 12px;
            text-transform: uppercase;
        }
        .error-message {
            font-size: 16px;
            color: #2c3e50;
            font-weight: 500;
            margin: 10px 0;
        }
        .error-meta {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 10px;
            margin-top: 10px;
        }
        .meta-item {
            background: white;
            padding: 8px;
            border-radius: 4px;
            border-left: 3px solid #3498db;
        }
        .meta-label {
            font-size: 11px;
            color: #7f8c8d;
            text-transform: uppercase;
            font-weight: bold;
        }
        .meta-value {
            font-size: 13px;
            color: #2c3e50;
            font-family: 'Courier New', monospace;
        }
        .summary {
            background: #3498db;
            color: white;
            padding: 20px;
            border-radius: 6px;
            margin-bottom: 30px;
        }
        .summary-stats {
            display: flex;
            gap: 30px;
            margin-top: 15px;
        }
        .summary-stat {
            text-align: center;
        }
        .summary-stat-value {
            font-size: 32px;
            font-weight: bold;
        }
        .summary-stat-label {
            font-size: 14px;
            opacity: 0.9;
        }
        .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            color: #7f8c8d;
            font-size: 14px;
        }
        /* Modal styles */
        .modal {
            display: none;
            position: fixed;
            z-index: 10000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.9);
            animation: fadeIn 0.3s;
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .modal-content {
            position: relative;
            margin: 2% auto;
            padding: 20px;
            width: 95%;
            max-width: none;
            max-height: 90vh;
            overflow: auto;
            display: flex;
            align-items: flex-start;
            justify-content: center;
        }
        .modal-content img {
            width: auto;
            height: auto;
            max-width: none;
            max-height: none;
            border-radius: 4px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            cursor: default;
        }
        .modal-close {
            position: absolute;
            top: 15px;
            right: 35px;
            color: #f1f1f1;
            font-size: 40px;
            font-weight: bold;
            cursor: pointer;
            background: rgba(0,0,0,0.5);
            width: 45px;
            height: 45px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
            transition: all 0.3s;
        }
        .modal-close:hover,
        .modal-close:focus {
            background: rgba(231, 76, 60, 0.8);
            transform: rotate(90deg);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 Accessibility Audit Report</h1>
        <p style="color: #7f8c8d;">Generated on: ${new Date().toLocaleString()} | Extension v1.8.1</p>
`;

    // Calculate summary
    let totalErrors = 0;
    let totalPages = 0;
    const flowCount = Object.keys(report).length;

    Object.values(report).forEach((flow) => {
      totalPages += Object.keys(flow).length;
      Object.values(flow).forEach((pageData) => {
        const errors = Array.isArray(pageData)
          ? pageData
          : pageData.errors || [];
        totalErrors += errors.length;
      });
    });

    htmlContent += `
        <div class="summary">
            <h2 style="margin: 0; color: white; border: none;">Summary</h2>
            <div class="summary-stats">
                <div class="summary-stat">
                    <div class="summary-stat-value">${flowCount}</div>
                    <div class="summary-stat-label">Flows</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value">${totalPages}</div>
                    <div class="summary-stat-label">Pages</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value">${totalErrors}</div>
                    <div class="summary-stat-label">Total Errors</div>
                </div>
            </div>
        </div>
`;

    // Add each flow
    Object.entries(report).forEach(([flowName, pages]) => {
      htmlContent += `<h2>📋 Flow: ${flowName}</h2>`;

      // Sort pages by timestamp
      const sortedPages = Object.entries(pages).sort((a, b) => {
        const timestampA = a[1].pageTimestamp || '';
        const timestampB = b[1].pageTimestamp || '';
        return timestampA.localeCompare(timestampB);
      });

      sortedPages.forEach(([pageName, pageData]) => {
        const errors = Array.isArray(pageData)
          ? pageData
          : pageData.errors || [];

        htmlContent += `<h3>📄 Page: ${pageName} (${errors.length} errors)</h3>`;

        errors.forEach((error, index) => {
          htmlContent += `
            <div class="error-card">
                <div class="error-screenshot">
                    ${
                      error.screenshot
                        ? `<img src="${error.screenshot}" alt="Element screenshot" title="Click to view full size with scroll" />
                           <div class="error-screenshot-hint">📸 Full container screenshot - Click to view complete image</div>`
                        : '<div class="no-image">No screenshot available</div>'
                    }
                </div>
                <div class="error-details">
                    <div>
                        <span class="error-code">${error.errorCode}</span>
                    </div>
                    <div class="error-message">${error.message}</div>
                    <div class="error-meta">
                        <div class="meta-item">
                            <div class="meta-label">Element</div>
                            <div class="meta-value">&lt;${
                              error.tagName
                            }&gt;</div>
                        </div>
                        ${
                          error.id
                            ? `<div class="meta-item">
                            <div class="meta-label">ID</div>
                            <div class="meta-value">${error.id}</div>
                        </div>`
                            : ''
                        }
                        ${
                          error.trackId
                            ? `<div class="meta-item">
                            <div class="meta-label">Track ID</div>
                            <div class="meta-value">${error.trackId}</div>
                        </div>`
                            : ''
                        }
                        ${
                          error.dataTestId
                            ? `<div class="meta-item">
                            <div class="meta-label">Data-Test-ID</div>
                            <div class="meta-value">${error.dataTestId}</div>
                        </div>`
                            : ''
                        }
                        ${
                          error.className
                            ? `<div class="meta-item">
                            <div class="meta-label">Class</div>
                            <div class="meta-value">${error.className}</div>
                        </div>`
                            : ''
                        }
                        ${
                          error.size
                            ? `<div class="meta-item">
                            <div class="meta-label">Size</div>
                            <div class="meta-value">${error.size}</div>
                        </div>`
                            : ''
                        }
                        ${
                          error.position
                            ? `<div class="meta-item">
                            <div class="meta-label">Position</div>
                            <div class="meta-value">${error.position}</div>
                        </div>`
                            : ''
                        }
                        ${
                          error.innerText
                            ? `<div class="meta-item">
                            <div class="meta-label">Text Content</div>
                            <div class="meta-value">${error.innerText}</div>
                        </div>`
                            : ''
                        }
                    </div>
                </div>
            </div>
          `;
        });
      });
    });

    htmlContent += `
        <div class="footer">
            <p>by @soyJairoCosta</p>
            <p>Accessibility Checker v1.6.1</p>
        </div>
    </div>

    <!-- Image Modal -->
    <div id="imageModal" class="modal">
        <span class="modal-close" onclick="closeModal()">&times;</span>
        <div class="modal-content">
            <img id="modalImage" src="" alt="Full size screenshot">
        </div>
    </div>

    <script>
        // Open modal when clicking on screenshot
        document.addEventListener('click', function(e) {
            if (e.target.tagName === 'IMG' && e.target.closest('.error-screenshot')) {
                const modal = document.getElementById('imageModal');
                const modalImg = document.getElementById('modalImage');
                modal.style.display = 'block';
                modalImg.src = e.target.src;
            }
        });

        // Close modal function
        function closeModal() {
            document.getElementById('imageModal').style.display = 'none';
        }

        // Close modal when clicking outside the image
        document.getElementById('imageModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal();
            }
        });

        // Close modal with ESC key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeModal();
            }
        });
    </script>
</body>
</html>
`;

    // Create download
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, -5);
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `accessibility-report-with-screenshots-${timestamp}.html`
    );
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Refresh report summary after each analysis
  const originalShowStatus = showStatus;
  showStatus = function (message, type) {
    originalShowStatus(message, type);
    if (type === 'success' && message.includes('Analysis complete')) {
      setTimeout(() => loadReportSummary(), 500);
    }
  };
});
