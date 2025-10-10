// Listen for messages from popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === 'runAudit') {
    // Clear previous highlights
    clearHighlights();

    // Set analysis status to 'in-progress' immediately
    chrome.storage.local.set({ analysisStatus: 'in-progress' });

    // Run the audit asynchronously to capture screenshots
    runAccessibilityAudit(request.divClass, request.options, request.flowName)
      .then((result) => {
        // Mark analysis as complete
        chrome.storage.local.set({ analysisStatus: 'completed' });
        sendResponse(result);
      })
      .catch((error) => {
        // Mark analysis as failed
        chrome.storage.local.set({
          analysisStatus: 'failed',
          analysisError: error.message,
        });
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep message channel open for async response
  } else if (request.action === 'getReport') {
    // Return stored report data (handled by report.js)
    getReport(function (report) {
      sendResponse(report);
    });
    return true;
  } else if (request.action === 'clearReport') {
    // Clear stored report data (handled by report.js)
    clearReport(function (response) {
      sendResponse(response);
    });
    return true;
  } else if (request.action === 'captureFullPage') {
    // Capture full page screenshot
    sendResponse({
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      clientWidth: document.documentElement.clientWidth,
    });
    return true;
  }
  return true;
});

/**
 * Helper function to add timeout to a promise
 * @param {Promise} promise - The promise to add timeout to
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise} Promise that rejects if timeout is exceeded
 */
function promiseWithTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Screenshot timeout')), timeoutMs)
    ),
  ]);
}

/**
 * Helper function to retry a screenshot capture with exponential backoff
 * @param {Function} captureFunc - Function that returns a promise
 * @param {number} maxRetries - Maximum number of retries (default 1 to respect quota)
 * @param {number} timeoutMs - Timeout per attempt (default 5000ms)
 * @returns {Promise} Screenshot data or null
 */
async function retryScreenshotCapture(
  captureFunc,
  maxRetries = 1,
  timeoutMs = 5000
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Attempt capture with timeout
      const result = await promiseWithTimeout(captureFunc(), timeoutMs);
      return result;
    } catch (error) {
      console.warn(`Screenshot attempt ${attempt} failed:`, error.message);

      // If this was the last attempt, return null
      if (attempt === maxRetries) {
        console.error('All screenshot attempts failed');
        return null;
      }

      // Wait before retrying (exponential backoff)
      const delay = 100 * attempt; // 100ms, 200ms, etc.
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return null;
}

/**
 * Capture screenshot centered on element with error
 * Scrolls to element, captures visible viewport, and adds highlight
 * @param {HTMLElement} element - Element with error
 * @param {HTMLElement} container - Container being audited
 * @returns {Promise<string|null>} Base64 data URL or null if capture fails
 */
async function captureElementScreenshot(element, container = null) {
  try {
    // Find container if not provided
    if (!container) {
      container = element.closest('.a11y-audit-container') || document.body;
    }

    // Get element dimensions
    const elementRect = element.getBoundingClientRect();

    // Check if element exists in DOM (even if 0x0)
    // For 0x0 elements (empty containers), we need to find a visible parent
    const is0x0 = elementRect.width === 0 && elementRect.height === 0;
    const isTooSmall = elementRect.width < 5 && elementRect.height < 5;

    // Minimum reasonable size for a parent element to capture (in pixels)
    const MIN_PARENT_WIDTH = 40;
    const MIN_PARENT_HEIGHT = 40;

    // For 0x0 or very small elements, find the first parent with reasonable dimensions
    let captureTarget = element;
    let captureTargetRect = elementRect;
    let needsParentCapture = is0x0 || isTooSmall;

    if (needsParentCapture) {
      console.log(
        'Element is 0x0 or too small, searching for visible parent with reasonable size...',
        {
          elementTag: element.tagName,
          elementClass: element.className,
          elementSize: `${elementRect.width}x${elementRect.height}`,
          elementPosition: `x:${Math.round(elementRect.left)}, y:${Math.round(
            elementRect.top
          )}`,
        }
      );

      // Walk up the DOM tree to find a parent with reasonable dimensions
      let parent = element.parentElement;
      let attempts = 0;
      const maxAttempts = 15; // Increased depth for better parent finding

      while (parent && attempts < maxAttempts) {
        const parentRect = parent.getBoundingClientRect();

        // Found a parent with reasonable dimensions (not just > 0)
        const hasReasonableWidth = parentRect.width >= MIN_PARENT_WIDTH;
        const hasReasonableHeight = parentRect.height >= MIN_PARENT_HEIGHT;

        if (hasReasonableWidth && hasReasonableHeight) {
          captureTarget = parent;
          captureTargetRect = parentRect;
          console.log('✓ Found suitable parent:', {
            tag: parent.tagName,
            class: parent.className,
            width: Math.round(parentRect.width),
            height: Math.round(parentRect.height),
            position: `x:${Math.round(parentRect.left)}, y:${Math.round(
              parentRect.top
            )}`,
          });
          break;
        }

        parent = parent.parentElement;
        attempts++;
      }

      // If we couldn't find a suitable parent, use body as fallback
      if (
        captureTargetRect.width < MIN_PARENT_WIDTH ||
        captureTargetRect.height < MIN_PARENT_HEIGHT
      ) {
        console.warn('Could not find suitable parent, using body as fallback');
        captureTarget = document.body;
        captureTargetRect = document.body.getBoundingClientRect();
      }
    }

    // Log what we're about to capture
    if (needsParentCapture) {
      console.log('📸 Capturing parent with marker for small/empty element:', {
        element: `<${element.tagName.toLowerCase()}> (${Math.round(
          elementRect.width
        )}x${Math.round(elementRect.height)})`,
        elementPosition: `x:${Math.round(elementRect.left)}, y:${Math.round(
          elementRect.top
        )}`,
        captureTarget: `<${captureTarget.tagName.toLowerCase()}>`,
        targetSize: `${Math.round(captureTargetRect.width)}x${Math.round(
          captureTargetRect.height
        )}`,
        targetPosition: `x:${Math.round(
          captureTargetRect.left
        )}, y:${Math.round(captureTargetRect.top)}`,
      });
    } else {
      console.log('📸 Capturing element directly:', {
        element: element.tagName,
        size: `${Math.round(elementRect.width)}x${Math.round(
          elementRect.height
        )}`,
        position: `x:${Math.round(elementRect.left)}, y:${Math.round(
          elementRect.top
        )}`,
      });
    }

    // Save current scroll position
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;

    try {
      // Scroll the capture target into view
      captureTarget.scrollIntoView({
        behavior: 'instant',
        block: 'center',
        inline: 'center',
      });

      // Wait for scroll to complete and rendering
      // Optimized: 150ms is sufficient for scroll completion
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Get positions after scroll
      const elementRectAfterScroll = element.getBoundingClientRect();
      const captureTargetRectAfterScroll =
        captureTarget.getBoundingClientRect();

      // Add small delay before capture to respect quota
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Capture screenshot via background script
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'captureVisibleTab' },
          (response) => resolve(response)
        );
      });

      // Restore original scroll position
      window.scrollTo(originalScrollX, originalScrollY);

      if (!response || !response.dataUrl) {
        console.error('Failed to capture screenshot');
        return await createSimplifiedScreenshot(
          element,
          container,
          elementRect,
          container.getBoundingClientRect()
        );
      }

      // Verify that the capture target is actually visible in the viewport after scroll
      const isTargetVisible =
        captureTargetRectAfterScroll.top >= 0 &&
        captureTargetRectAfterScroll.left >= 0 &&
        captureTargetRectAfterScroll.bottom <= window.innerHeight &&
        captureTargetRectAfterScroll.right <= window.innerWidth;

      if (!isTargetVisible) {
        console.warn('⚠️ Capture target not fully visible after scroll:', {
          target: captureTarget.tagName,
          rect: {
            top: Math.round(captureTargetRectAfterScroll.top),
            left: Math.round(captureTargetRectAfterScroll.left),
            bottom: Math.round(captureTargetRectAfterScroll.bottom),
            right: Math.round(captureTargetRectAfterScroll.right),
          },
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        });
      }

      // If we're capturing a parent (for 0x0 or too small elements),
      // we need to mark where the original element is within the parent
      if (needsParentCapture) {
        console.log('✓ Using parent capture with element marker');
        // Capture the parent but mark where the empty/small element should be
        return await cropAndHighlightParentWithMarker(
          response.dataUrl,
          captureTargetRectAfterScroll.left,
          captureTargetRectAfterScroll.top,
          captureTargetRectAfterScroll.width,
          captureTargetRectAfterScroll.height,
          elementRectAfterScroll.left,
          elementRectAfterScroll.top,
          element.tagName,
          captureTarget.tagName,
          elementRect.width, // Original element width
          elementRect.height // Original element height
        );
      } else {
        console.log('✓ Using direct element capture');
        // Normal element capture
        return await cropAndHighlightElement(
          response.dataUrl,
          elementRectAfterScroll.left,
          elementRectAfterScroll.top,
          elementRectAfterScroll.width,
          elementRectAfterScroll.height,
          element.tagName,
          false // Not capturing as small element since we have the actual element
        );
      }
    } catch (error) {
      console.error('Error during screenshot capture:', error);
      // Restore scroll position
      window.scrollTo(originalScrollX, originalScrollY);
      throw error;
    }
  } catch (error) {
    console.error('Error capturing element screenshot:', error);
    return await createSimplifiedScreenshot(
      element,
      container,
      element.getBoundingClientRect(),
      container.getBoundingClientRect()
    );
  }
}

/**
 * Crop screenshot to element area and add red highlight border
 * This captures only the element + margins, not the full viewport
 */
async function cropAndHighlightElement(
  screenshotDataUrl,
  elementX,
  elementY,
  elementWidth,
  elementHeight,
  tagName,
  isSmallElement = false
) {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;

      // Define margins around element (in logical pixels)
      const margin = isSmallElement ? 40 : 30;

      // Ensure minimum visible size for small elements
      const minSize = 60;
      let displayWidth = Math.max(elementWidth, isSmallElement ? minSize : 0);
      let displayHeight = Math.max(elementHeight, isSmallElement ? minSize : 0);

      // Calculate crop area with margins
      const cropX = Math.max(0, elementX - margin);
      const cropY = Math.max(0, elementY - margin);
      const cropWidth = Math.min(
        img.width / dpr - cropX,
        displayWidth + margin * 2
      );
      const cropHeight = Math.min(
        img.height / dpr - cropY,
        displayHeight + margin * 2
      );

      // Create canvas for cropped image
      const canvas = document.createElement('canvas');
      canvas.width = cropWidth * dpr;
      canvas.height = cropHeight * dpr;
      const ctx = canvas.getContext('2d');

      // Calculate source coordinates (in actual image pixels)
      const srcX = cropX * dpr;
      const srcY = cropY * dpr;
      const srcWidth = cropWidth * dpr;
      const srcHeight = cropHeight * dpr;

      // Draw cropped portion of screenshot
      ctx.drawImage(
        img,
        srcX,
        srcY,
        srcWidth,
        srcHeight, // Source
        0,
        0,
        canvas.width,
        canvas.height // Destination
      );

      // Calculate element position relative to cropped area
      const relativeX = (elementX - cropX) * dpr;
      const relativeY = (elementY - cropY) * dpr;
      let highlightWidth = displayWidth * dpr;
      let highlightHeight = displayHeight * dpr;

      // Draw red highlight border
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 3 * dpr;
      ctx.setLineDash([]);
      ctx.strokeRect(relativeX, relativeY, highlightWidth, highlightHeight);

      // For small elements, add a crosshair to mark exact position
      if (isSmallElement) {
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 2 * dpr;
        const centerX = relativeX + highlightWidth / 2;
        const centerY = relativeY + highlightHeight / 2;
        const crossSize = 10 * dpr;

        // Horizontal line
        ctx.beginPath();
        ctx.moveTo(centerX - crossSize, centerY);
        ctx.lineTo(centerX + crossSize, centerY);
        ctx.stroke();

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - crossSize);
        ctx.lineTo(centerX, centerY + crossSize);
        ctx.stroke();
      }

      // Add label
      const tagInfo = isSmallElement
        ? `<${tagName.toLowerCase()}> (empty/small)`
        : `<${tagName.toLowerCase()}>`;
      const labelPadding = 8 * dpr;
      const labelHeight = 24 * dpr;
      ctx.font = `bold ${14 * dpr}px Arial`;
      const labelWidth = ctx.measureText(tagInfo).width + labelPadding * 2;

      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(
        relativeX,
        Math.max(0, relativeY - labelHeight),
        labelWidth,
        labelHeight
      );

      ctx.fillStyle = 'white';
      ctx.fillText(
        tagInfo,
        relativeX + labelPadding,
        Math.max(labelHeight - 6 * dpr, relativeY - 6 * dpr)
      );

      // Compress and resolve
      compressImage(canvas, (compressedDataUrl) => {
        resolve(compressedDataUrl);
      });
    };

    img.onerror = () => {
      console.error('Failed to load screenshot image');
      resolve(null);
    };

    img.src = screenshotDataUrl;
  });
}

/**
 * Crop screenshot to parent element and mark where the 0x0 element is located
 * This is used for empty/invisible elements to show their context
 */
async function cropAndHighlightParentWithMarker(
  screenshotDataUrl,
  parentX,
  parentY,
  parentWidth,
  parentHeight,
  elementX,
  elementY,
  elementTag,
  parentTag,
  elementOriginalWidth = 0,
  elementOriginalHeight = 0
) {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;

      // Define margins around parent - larger margin for better context
      const margin = 40;

      // Calculate crop area for parent with margins
      const cropX = Math.max(0, parentX - margin);
      const cropY = Math.max(0, parentY - margin);
      const cropWidth = Math.min(
        img.width / dpr - cropX,
        parentWidth + margin * 2
      );
      const cropHeight = Math.min(
        img.height / dpr - cropY,
        parentHeight + margin * 2
      );

      // Create canvas for cropped image
      const canvas = document.createElement('canvas');
      canvas.width = cropWidth * dpr;
      canvas.height = cropHeight * dpr;
      const ctx = canvas.getContext('2d');

      // Calculate source coordinates (in actual image pixels)
      const srcX = cropX * dpr;
      const srcY = cropY * dpr;
      const srcWidth = cropWidth * dpr;
      const srcHeight = cropHeight * dpr;

      // Draw cropped portion of screenshot
      ctx.drawImage(
        img,
        srcX,
        srcY,
        srcWidth,
        srcHeight, // Source
        0,
        0,
        canvas.width,
        canvas.height // Destination
      );

      // Calculate parent position relative to cropped area
      const relativeParentX = (parentX - cropX) * dpr;
      const relativeParentY = (parentY - cropY) * dpr;
      const relativeParentWidth = parentWidth * dpr;
      const relativeParentHeight = parentHeight * dpr;

      // Draw blue box around parent (context)
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([5 * dpr, 5 * dpr]);
      ctx.strokeRect(
        relativeParentX,
        relativeParentY,
        relativeParentWidth,
        relativeParentHeight
      );
      ctx.setLineDash([]);

      // Calculate element marker position relative to cropped area
      const markerX = (elementX - cropX) * dpr;
      const markerY = (elementY - cropY) * dpr;
      const markerSize = 25 * dpr; // Larger marker for better visibility

      // Draw a prominent marker to indicate the element position
      // Style 1: Large outer circle with glow effect
      ctx.shadowColor = '#e74c3c';
      ctx.shadowBlur = 10 * dpr;
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 4 * dpr;
      ctx.beginPath();
      ctx.arc(markerX, markerY, markerSize, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow

      // Style 2: Inner filled circle
      ctx.fillStyle = 'rgba(231, 76, 60, 0.3)'; // Semi-transparent red
      ctx.beginPath();
      ctx.arc(markerX, markerY, markerSize * 0.6, 0, 2 * Math.PI);
      ctx.fill();

      // Style 3: Crosshair
      ctx.strokeStyle = '#fff'; // White crosshair for contrast
      ctx.lineWidth = 3 * dpr;

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(markerX - markerSize * 0.7, markerY);
      ctx.lineTo(markerX + markerSize * 0.7, markerY);
      ctx.stroke();

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(markerX, markerY - markerSize * 0.7);
      ctx.lineTo(markerX, markerY + markerSize * 0.7);
      ctx.stroke();

      // Add small center dot
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(markerX, markerY, 3 * dpr, 0, 2 * Math.PI);
      ctx.fill();

      // Add arrow pointing to the element from above
      const arrowStartY = markerY - markerSize * 2;
      const arrowEndY = markerY - markerSize * 1.2;

      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.moveTo(markerX, arrowStartY);
      ctx.lineTo(markerX, arrowEndY);
      ctx.stroke();

      // Arrow head
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(markerX, arrowEndY);
      ctx.lineTo(markerX - 6 * dpr, arrowEndY - 8 * dpr);
      ctx.lineTo(markerX + 6 * dpr, arrowEndY - 8 * dpr);
      ctx.closePath();
      ctx.fill();

      // Add label for the element
      const sizeInfo =
        elementOriginalWidth === 0 && elementOriginalHeight === 0
          ? '0x0 - empty'
          : `${Math.round(elementOriginalWidth)}x${Math.round(
              elementOriginalHeight
            )}px`;
      const elementInfo = `<${elementTag.toLowerCase()}> (${sizeInfo})`;
      const labelPadding = 10 * dpr;
      const labelHeight = 28 * dpr;
      ctx.font = `bold ${13 * dpr}px Arial`;
      const labelWidth = ctx.measureText(elementInfo).width + labelPadding * 2;

      // Position label above the arrow
      const labelY = arrowStartY - labelHeight - 5 * dpr;
      const labelX = markerX - labelWidth / 2;

      // Draw label background with border
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(labelX, Math.max(0, labelY), labelWidth, labelHeight);

      // Draw white border for label
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(labelX, Math.max(0, labelY), labelWidth, labelHeight);

      ctx.fillStyle = 'white';
      ctx.fillText(
        elementInfo,
        labelX + labelPadding,
        Math.max(labelHeight - 8 * dpr, labelY + labelHeight - 8 * dpr)
      );

      // Add label for parent context (at top of parent box)
      const parentInfo = `Parent: <${parentTag.toLowerCase()}>`;
      ctx.font = `${11 * dpr}px Arial`;
      const parentLabelWidth =
        ctx.measureText(parentInfo).width + labelPadding * 2;
      const parentLabelHeight = 22 * dpr;

      ctx.fillStyle = '#3498db';
      ctx.fillRect(
        relativeParentX,
        Math.max(0, relativeParentY - parentLabelHeight),
        parentLabelWidth,
        parentLabelHeight
      );

      ctx.fillStyle = 'white';
      ctx.fillText(
        parentInfo,
        relativeParentX + labelPadding,
        Math.max(parentLabelHeight - 6 * dpr, relativeParentY - 6 * dpr)
      );

      // Compress and resolve
      compressImage(canvas, (compressedDataUrl) => {
        resolve(compressedDataUrl);
      });
    };

    img.onerror = () => {
      console.error('Failed to load screenshot image');
      resolve(null);
    };

    img.src = screenshotDataUrl;
  });
}

/**
 * Old function - kept for fallback but now calls cropAndHighlightElement
 */
async function addHighlightToScreenshot(
  screenshotDataUrl,
  elementX,
  elementY,
  elementWidth,
  elementHeight,
  tagName
) {
  // Redirect to new cropped version
  return cropAndHighlightElement(
    screenshotDataUrl,
    elementX,
    elementY,
    elementWidth,
    elementHeight,
    tagName,
    false
  );
}

/**
 * Compress and resize image to reduce storage size
 * @param {HTMLCanvasElement} canvas - Canvas with the image
 * @param {function|number} qualityOrCallback - Callback function or quality number (0.0 to 1.0)
 * @param {number} maxWidth - Maximum width in pixels (default: 800)
 * @returns {string|undefined} Compressed data URL (if no callback) or undefined (if callback)
 */
function compressImage(canvas, qualityOrCallback = 0.6, maxWidth = 800) {
  try {
    // Check if first parameter is a callback
    const isCallback = typeof qualityOrCallback === 'function';
    const quality = isCallback ? 0.6 : qualityOrCallback;
    const callback = isCallback ? qualityOrCallback : null;

    // Calculate new dimensions maintaining aspect ratio
    const originalWidth = canvas.width;
    const originalHeight = canvas.height;

    let newWidth = originalWidth;
    let newHeight = originalHeight;

    if (originalWidth > maxWidth) {
      newWidth = maxWidth;
      newHeight = Math.round((originalHeight * maxWidth) / originalWidth);
    }

    // If already small enough, just compress
    if (newWidth === originalWidth && newHeight === originalHeight) {
      const result = canvas.toDataURL('image/jpeg', quality);
      if (callback) {
        callback(result);
        return;
      }
      return result;
    }

    // Create new canvas with smaller dimensions
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = newWidth;
    smallCanvas.height = newHeight;
    const ctx = smallCanvas.getContext('2d');

    // Use better image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw resized image
    ctx.drawImage(canvas, 0, 0, newWidth, newHeight);

    // Return as compressed JPEG
    const result = smallCanvas.toDataURL('image/jpeg', quality);
    if (callback) {
      callback(result);
      return;
    }
    return result;
  } catch (error) {
    console.error('Error compressing image:', error);
    // Fallback to original with JPEG compression
    const quality =
      typeof qualityOrCallback === 'number' ? qualityOrCallback : 0.6;
    const result = canvas.toDataURL('image/jpeg', quality);
    if (typeof qualityOrCallback === 'function') {
      qualityOrCallback(result);
      return;
    }
    return result;
  }
}

/**
 * Create a simplified visual representation of container with element highlighted
 */
async function stitchScreenshotsAndHighlight(
  screenshots,
  elementX,
  elementY,
  elementWidth,
  elementHeight,
  tagName,
  pageWidth,
  pageHeight,
  viewportHeight,
  dpr
) {
  return new Promise((resolve) => {
    // Create canvas for full page
    const canvas = document.createElement('canvas');
    canvas.width = pageWidth * dpr;
    canvas.height = pageHeight * dpr;
    const ctx = canvas.getContext('2d');

    // Fill with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let imagesLoaded = 0;
    const totalImages = screenshots.length;

    // Load and draw each screenshot
    screenshots.forEach((screenshot) => {
      const img = new Image();

      img.onload = () => {
        // Draw screenshot at correct position
        ctx.drawImage(img, 0, screenshot.scrollY * dpr, img.width, img.height);

        imagesLoaded++;

        // When all images are loaded, add highlight
        if (imagesLoaded === totalImages) {
          // Draw red highlight border
          const highlightX = elementX * dpr;
          const highlightY = elementY * dpr;
          const highlightWidth = elementWidth * dpr;
          const highlightHeight = elementHeight * dpr;

          ctx.strokeStyle = '#e74c3c';
          ctx.lineWidth = 4 * dpr;
          ctx.setLineDash([]);
          ctx.strokeRect(
            highlightX,
            highlightY,
            highlightWidth,
            highlightHeight
          );

          // Add label
          const tagInfo = `<${tagName.toLowerCase()}>`;
          const labelPadding = 8 * dpr;
          const labelHeight = 24 * dpr;
          ctx.font = `bold ${14 * dpr}px Arial`;
          const labelWidth = ctx.measureText(tagInfo).width + labelPadding * 2;

          ctx.fillStyle = '#e74c3c';
          ctx.fillRect(
            highlightX,
            Math.max(0, highlightY - labelHeight),
            labelWidth,
            labelHeight
          );

          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(
            tagInfo,
            highlightX + labelPadding,
            Math.max(0, highlightY - labelHeight) + 5 * dpr
          );

          console.log('Full page screenshot created with highlight');
          resolve(canvas.toDataURL('image/png'));
        }
      };

      img.onerror = () => {
        console.error('Failed to load screenshot image');
        imagesLoaded++;
        if (imagesLoaded === totalImages) {
          resolve(canvas.toDataURL('image/png'));
        }
      };

      img.src = screenshot.dataUrl;
    });
  });
}

/**
 * Draw red highlight border on a container screenshot
 * @param {string} screenshotDataUrl - Base screenshot image of full container
 * @param {number} relativeX - Element X position relative to container
 * @param {number} relativeY - Element Y position relative to container
 * @param {number} elementWidth - Element width
 * @param {number} elementHeight - Element height
 * @param {string} tagName - Element tag name
 * @returns {Promise<string>} Screenshot with red border
 */
async function drawHighlightOnContainer(
  screenshotDataUrl,
  relativeX,
  relativeY,
  elementWidth,
  elementHeight,
  tagName
) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Use full image size (the complete container)
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw the full container screenshot
      ctx.drawImage(img, 0, 0, img.width, img.height);

      // Element position is already relative to container, no DPR needed
      // since html2canvas renders at scale: 1
      const highlightX = relativeX;
      const highlightY = relativeY;
      const highlightWidth = elementWidth;
      const highlightHeight = elementHeight;

      // Draw RED HIGHLIGHT BORDER
      const borderWidth = 4;

      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = borderWidth;
      ctx.setLineDash([]);

      ctx.strokeRect(highlightX, highlightY, highlightWidth, highlightHeight);

      // Add tag label
      const tagInfo = `<${tagName.toLowerCase()}>`;
      const labelPadding = 8;
      const labelHeight = 24;
      ctx.font = 'bold 14px Arial';
      const labelWidth = ctx.measureText(tagInfo).width + labelPadding * 2;

      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(
        highlightX,
        Math.max(0, highlightY - labelHeight),
        labelWidth,
        labelHeight
      );

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(
        tagInfo,
        highlightX + labelPadding,
        Math.max(0, highlightY - labelHeight) + 5
      );

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      console.error('Failed to load container screenshot image');
      resolve(null);
    };
    img.src = screenshotDataUrl;
  });
}

/**
 * Draw red highlight border on a screenshot
 * @param {string} screenshotDataUrl - Base screenshot image
 * @param {DOMRect} elementRect - Element bounds
 * @param {DOMRect} containerRect - Container bounds
 * @param {string} tagName - Element tag name
 * @returns {Promise<string>} Screenshot with red border
 */
async function drawHighlightOnScreenshot(
  screenshotDataUrl,
  elementRect,
  containerRect,
  tagName
) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // The screenshot is at device pixel ratio scale
      // We need to use the full image size without additional scaling
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw the captured screenshot at full size
      ctx.drawImage(img, 0, 0, img.width, img.height);

      // Calculate scale factor based on device pixel ratio
      const dpr = window.devicePixelRatio || 1;

      // Element position with device pixel ratio
      const relativeX = elementRect.left * dpr;
      const relativeY = elementRect.top * dpr;
      const elementWidth = elementRect.width * dpr;
      const elementHeight = elementRect.height * dpr;

      // Draw RED HIGHLIGHT BORDER (no offset - exact position)
      const borderWidth = 4 * dpr;

      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = borderWidth;
      ctx.setLineDash([]);

      ctx.strokeRect(relativeX, relativeY, elementWidth, elementHeight);

      // Add tag label
      const tagInfo = `<${tagName.toLowerCase()}>`;
      const labelPadding = 8 * dpr;
      const labelHeight = 24 * dpr;
      ctx.font = `bold ${14 * dpr}px Arial`;
      const labelWidth = ctx.measureText(tagInfo).width + labelPadding * 2;

      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(
        relativeX,
        Math.max(0, relativeY - labelHeight),
        labelWidth,
        labelHeight
      );

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(
        tagInfo,
        relativeX + labelPadding,
        Math.max(0, relativeY - labelHeight) + 5 * dpr
      );

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      console.error('Failed to load screenshot image');
      resolve(null);
    };
    img.src = screenshotDataUrl;
  });
}

/**
 * Create a simplified canvas-based screenshot (last fallback)
 * @param {HTMLElement} element - Element to highlight
 * @param {HTMLElement} container - Container element
 * @param {DOMRect} elementRect - Element bounding rect
 * @param {DOMRect} containerRect - Container bounding rect
 * @returns {Promise<string>} Base64 data URL
 */
async function createSimplifiedScreenshot(
  element,
  container,
  elementRect,
  containerRect
) {
  const canvas = document.createElement('canvas');
  const maxWidth = 800;
  const maxHeight = 600;

  // Calculate scaled dimensions
  let width = Math.min(containerRect.width, maxWidth);
  let height = Math.min(containerRect.height, maxHeight);

  const scale = Math.min(
    maxWidth / containerRect.width,
    maxHeight / containerRect.height,
    1
  );

  width = containerRect.width * scale;
  height = containerRect.height * scale;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');

  // Draw container background
  const containerStyles = window.getComputedStyle(container);
  const bgColor = containerStyles.backgroundColor;

  if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }

  // Draw a simplified representation of the container
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, width, height);

  // Calculate element position relative to container
  const relativeX = (elementRect.left - containerRect.left) * scale;
  const relativeY = (elementRect.top - containerRect.top) * scale;
  let elementWidth = elementRect.width * scale;
  let elementHeight = elementRect.height * scale;

  // For very small elements, ensure minimum visible size
  const minSize = 20;
  const isSmallElement = elementWidth < minSize || elementHeight < minSize;
  let adjustedX = relativeX;
  let adjustedY = relativeY;

  if (isSmallElement) {
    const expandAmount = minSize / 2;
    adjustedX = Math.max(0, relativeX - expandAmount / 2);
    adjustedY = Math.max(0, relativeY - expandAmount / 2);
    elementWidth = Math.max(minSize, elementWidth + expandAmount);
    elementHeight = Math.max(minSize, elementHeight + expandAmount);
  }

  // Draw element background
  const elementStyles = window.getComputedStyle(element);
  const elementBg = elementStyles.backgroundColor;

  if (elementBg && elementBg !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = elementBg;
    ctx.fillRect(adjustedX, adjustedY, elementWidth, elementHeight);
  }

  // Draw element text if present
  const text = element.innerText || element.textContent || '';
  if (text.trim()) {
    const fontSize = parseFloat(elementStyles.fontSize) * scale || 12;
    const color = elementStyles.color || '#000000';

    ctx.fillStyle = color;
    ctx.font = `${Math.max(fontSize, 10)}px ${
      elementStyles.fontFamily || 'Arial'
    }`;
    ctx.textBaseline = 'top';

    // Wrap text
    const words = text.trim().substring(0, 100).split(' ');
    let line = '';
    let y = adjustedY + 5;
    const lineHeight = fontSize * 1.2;

    for (let word of words) {
      const testLine = line + word + ' ';
      const metrics = ctx.measureText(testLine);

      if (metrics.width > elementWidth - 10 && line !== '') {
        ctx.fillText(line, adjustedX + 5, y);
        line = word + ' ';
        y += lineHeight;
        if (y > adjustedY + elementHeight - lineHeight) break;
      } else {
        line = testLine;
      }
    }
    if (line && y < adjustedY + elementHeight) {
      ctx.fillText(line, adjustedX + 5, y);
    }
  }

  // Draw RED HIGHLIGHT BORDER around element (no offset - exact position)
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 4;
  ctx.setLineDash([]);

  ctx.strokeRect(adjustedX, adjustedY, elementWidth, elementHeight);

  // For small elements, add a crosshair to mark exact position
  if (isSmallElement) {
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2;
    const centerX = adjustedX + elementWidth / 2;
    const centerY = adjustedY + elementHeight / 2;
    const crossSize = 10;

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(centerX - crossSize, centerY);
    ctx.lineTo(centerX + crossSize, centerY);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - crossSize);
    ctx.lineTo(centerX, centerY + crossSize);
    ctx.stroke();
  }

  // Add label at top
  const tagInfo = isSmallElement
    ? `<${element.tagName.toLowerCase()}> (empty/small)`
    : `<${element.tagName.toLowerCase()}>`;
  const labelPadding = 4;
  const labelHeight = 20;

  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(
    adjustedX,
    Math.max(0, adjustedY - labelHeight),
    ctx.measureText(tagInfo).width + labelPadding * 2,
    labelHeight
  );

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    tagInfo,
    adjustedX + labelPadding,
    Math.max(0, adjustedY - labelHeight) + 3
  );

  return canvas.toDataURL('image/png');
}

function clearHighlights() {
  // Remove all existing error highlights
  // Remove all existing error highlights
  const existingHighlights = document.querySelectorAll('.a11y-error-highlight');
  existingHighlights.forEach((el) => el.remove());

  // Remove error classes from elements
  const highlightedElements = document.querySelectorAll('.a11y-has-error');
  highlightedElements.forEach((el) => {
    el.classList.remove('a11y-has-error');
    el.style.removeProperty('outline');
    el.style.removeProperty('outline-offset');
  });

  // Remove container highlight
  const containers = document.querySelectorAll('.a11y-audit-container');
  containers.forEach((el) => {
    el.classList.remove('a11y-audit-container');
    el.style.removeProperty('background');
    el.style.removeProperty('border');
    el.style.removeProperty('border-radius');
    el.style.removeProperty('box-shadow');
    el.style.removeProperty('margin');
  });
}

function highlightAuditContainer(container) {
  // Add visual highlight to the container being audited
  container.classList.add('a11y-audit-container');

  // Apply subtle but visible styling
  container.style.background = 'rgba(250, 253, 238, 0.5)'; // Light yellow-green with transparency
  container.style.border = '3px dashed #4caf50'; // Green dashed border
  container.style.borderRadius = '8px';
  container.style.boxShadow = '0 0 0 4px rgba(76, 175, 80, 0.1)'; // Soft green glow
  container.style.margin = '8px';

  // Smooth animation
  container.style.transition = 'all 0.3s ease-in-out';

  // Add a subtle pulse animation
  container.style.animation = 'a11y-pulse 2s ease-in-out';

  // Scroll the container into view
  container.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function runAccessibilityAudit(divClass, options, flowName = null) {
  try {
    // Find the target container - try both class selector and tag name
    let container = document.querySelector(`.${divClass}`);

    // If not found as class, try as tag name (for Angular custom elements like <app-int>)
    if (!container) {
      container = document.querySelector(divClass);
    }

    if (!container) {
      return {
        success: false,
        error: `Element with selector "${divClass}" not found on this page. Try without the dot (.) for custom elements.`,
      };
    }

    // Highlight the container being audited
    highlightAuditContainer(container);

    let errorCount = 0;
    const errors = [];

    // Get all elements within the container
    const allElements = container.querySelectorAll('*');

    // 1. Check font size (min 14px)
    if (options.fontSize) {
      errorCount += checkFontSize(allElements, errors);
    }

    // 2. Check clickable icon size (min 24px)
    if (options.iconSize) {
      errorCount += checkIconSize(allElements, errors);
    }

    // 3. Check color contrast
    if (options.contrast) {
      errorCount += checkColorContrast(allElements, errors);
    }

    // 4. Check border contrast
    if (options.borderContrast) {
      errorCount += checkBorderContrast(allElements, errors);
    }

    // 5. Check ARIA labels
    if (options.ariaLabel) {
      errorCount += checkAriaLabels(allElements, errors);
    }

    // 6. Check empty clickable elements (optional)
    if (options.emptyElements) {
      errorCount += checkEmptyElements(allElements, errors);
    }

    // ===== ADVANCED CHECKS =====

    // 7. Check focus visible (keyboard navigation)
    if (options.focusVisible) {
      errorCount += checkFocusVisible(allElements, errors);
    }

    // 8. Check tab order (tabindex issues)
    if (options.tabOrder) {
      errorCount += checkTabOrder(allElements, errors);
    }

    // 9. Check alt text (images & icons)
    if (options.altText) {
      errorCount += checkAltText(allElements, errors);
    }

    // 10. Check form labels (input associations)
    if (options.formLabels) {
      errorCount += checkFormLabels(allElements, errors);
    }

    // 11. Check headings structure (h1-h6 hierarchy)
    if (options.headings) {
      errorCount += checkHeadingsStructure(allElements, errors);
    }

    // 12. Check keyboard traps (focus management)
    if (options.keyboardTraps) {
      errorCount += checkKeyboardTraps(allElements, errors);
    }

    // 13. Check hidden content (aria-hidden issues)
    if (options.hiddenContent) {
      errorCount += checkHiddenContent(allElements, errors);
    }

    // 14. Check color dependence (visual-only info)
    if (options.colorDependence) {
      errorCount += checkColorDependence(allElements, errors);
    }

    // 15. Check language attributes (lang)
    if (options.language) {
      errorCount += checkLanguage(allElements, errors);
    }

    // 16. Check link text (descriptive links)
    if (options.linkText) {
      errorCount += checkLinkText(allElements, errors);
    }

    // Capture screenshots for all errors (async, in batches to avoid timeout)
    console.log(`Capturing screenshots for ${errors.length} errors...`);
    const BATCH_SIZE = 2; // CRITICAL: Max 2 per second to respect Chrome's quota
    const MAX_SCREENSHOTS = 100; // Reduced to avoid memory issues
    const DELAY_BETWEEN_BATCHES = 1100; // 1.1 seconds to respect quota (2 captures/second)

    // Filter out errors at position (0,0) FIRST to save memory
    // These elements are typically hidden/overlapping and screenshots are less useful
    const errorsToCapture = errors
      .filter((error) => {
        const elementRect = error.element.getBoundingClientRect();

        // Skip if position is (0,0)
        if (elementRect.left === 0 && elementRect.top === 0) {
          console.log(
            '⏭️ Skipping screenshot for element at (0,0):',
            error.element.tagName
          );
          error.screenshot = null; // Explicitly set to null
          return false;
        }

        return true;
      })
      .slice(0, MAX_SCREENSHOTS);

    const skippedCount = errors.filter((error) => {
      const elementRect = error.element.getBoundingClientRect();
      return elementRect.left === 0 && elementRect.top === 0;
    }).length;

    // Adaptive compression: BASED ON ACTUAL CAPTURES (after filtering 0,0)
    // This prioritizes non-(0,0) elements with better quality
    let compressionQuality = 0.6; // Default quality
    let maxImageWidth = 800; // Default width

    if (errorsToCapture.length > 80) {
      compressionQuality = 0.35; // Lower quality for many errors
      maxImageWidth = 550; // Smaller images
      console.log(
        `Using high compression (${errorsToCapture.length} non-(0,0) errors to capture)`
      );
    } else if (errorsToCapture.length > 60) {
      compressionQuality = 0.4; // Medium-low quality
      maxImageWidth = 600; // Smaller images
      console.log(
        `Using medium-high compression (${errorsToCapture.length} non-(0,0) errors)`
      );
    } else if (errorsToCapture.length > 40) {
      compressionQuality = 0.5; // Medium quality
      maxImageWidth = 700;
      console.log(
        `Using medium compression (${errorsToCapture.length} non-(0,0) errors)`
      );
    } else {
      console.log(
        `Using standard compression (${errorsToCapture.length} non-(0,0) errors)`
      );
    }

    // Store compression settings globally for use in screenshot function
    window._screenshotCompressionQuality = compressionQuality;
    window._screenshotMaxWidth = maxImageWidth;

    console.log(
      `Processing ${errorsToCapture.length} screenshots in batches of ${BATCH_SIZE}... (${skippedCount} skipped at position 0,0)`
    );
    let capturedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < errorsToCapture.length; i += BATCH_SIZE) {
      const batch = errorsToCapture.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (error, batchIndex) => {
          try {
            // Use retry logic with timeout
            // Reduced retries to avoid exceeding Chrome's capture quota
            error.screenshot = await retryScreenshotCapture(
              () => captureElementScreenshot(error.element, container),
              1, // max 1 retry (down from 2) to respect quota
              5000 // 5 second timeout per attempt
            );

            if (error.screenshot) {
              capturedCount++;
            } else {
              failedCount++;
              console.warn(
                `Failed to capture screenshot for error ${i + batchIndex + 1}`
              );
            }
          } catch (screenshotError) {
            console.warn('Failed to capture screenshot:', screenshotError);
            error.screenshot = null;
            failedCount++;
          }
        })
      );

      // Update progress in storage
      const progress = Math.min(
        100,
        Math.round(((i + BATCH_SIZE) / errorsToCapture.length) * 100)
      );
      chrome.storage.local.set({ analysisProgress: progress });
      console.log(
        `Screenshot progress: ${progress}% (${capturedCount} captured, ${failedCount} failed)`
      );

      // CRITICAL: Wait 1.1 seconds between batches to respect Chrome's quota
      // Chrome allows max 2 captureVisibleTab calls per second
      if (i + BATCH_SIZE < errorsToCapture.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, DELAY_BETWEEN_BATCHES)
        );
      }
    }

    // Log summary of screenshot capture
    console.log(
      `Screenshot capture complete: ${capturedCount} successful, ${failedCount} failed out of ${errorsToCapture.length} attempts (${skippedCount} skipped at 0,0)`
    );

    if (errors.length > MAX_SCREENSHOTS + skippedCount) {
      console.log(
        `Note: Captured screenshots for first ${MAX_SCREENSHOTS} eligible errors of ${errors.length} total (${skippedCount} at position 0,0 were skipped)`
      );
    } else if (skippedCount > 0) {
      console.log(
        `Note: Skipped ${skippedCount} screenshots for elements at position (0,0) to save memory`
      );
    }

    // Highlight all errors
    errors.forEach((error) => highlightError(error.element, error.message));

    // Store errors in report (with flowName if provided) - AWAIT to ensure it completes
    console.log('Saving report to storage...');
    try {
      await storeErrorsInReport(errors, flowName);
      console.log('Report saved successfully');
    } catch (saveError) {
      console.error('Error saving report:', saveError);
      // Even if saving fails, return success with error count
      // so the user knows the analysis completed
      return {
        success: true,
        errorCount: errorCount,
        warning: 'Analysis completed but report may not have saved completely',
      };
    }

    return {
      success: true,
      errorCount: errorCount,
    };
  } catch (error) {
    console.error('Error running audit:', error);
    return {
      success: false,
      error: 'Error running audit: ' + error.message,
    };
  }
}

function checkFontSize(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    // Check if element contains text
    const text = element.textContent.trim();
    if (!text || element.children.length > 0) return;

    const computedStyle = window.getComputedStyle(element);
    const fontSize = parseFloat(computedStyle.fontSize);

    if (fontSize < 14) {
      errors.push({
        element: element,
        message: `Text size too small: ${fontSize.toFixed(1)}px (min: 14px)`,
      });
      count++;
    }
  });

  return count;
}

function checkIconSize(elements, errors) {
  let count = 0;
  const checkedElements = new Set(); // Track already checked clickable parents

  elements.forEach((element) => {
    // Check if element is clickable (button, link, or has click handler)
    const isClickable =
      element.matches('button, a, [onclick], [role="button"]') ||
      element.style.cursor === 'pointer' ||
      window.getComputedStyle(element).cursor === 'pointer';

    if (!isClickable) return;

    // Find the topmost clickable parent to avoid marking children separately
    let targetElement = element;
    let parent = element.parentElement;

    while (parent) {
      const parentIsClickable =
        parent.matches('button, a, [onclick], [role="button"]') ||
        parent.style.cursor === 'pointer' ||
        window.getComputedStyle(parent).cursor === 'pointer';

      if (parentIsClickable) {
        targetElement = parent; // Use the parent as the target
      }
      parent = parent.parentElement;
    }

    // Skip if we already checked this clickable parent
    if (checkedElements.has(targetElement)) return;
    checkedElements.add(targetElement);

    // Get dimensions of the topmost clickable element
    const rect = targetElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Skip 0x0 elements (they'll be checked in checkEmptyElements if enabled)
    if (width === 0 || height === 0) return;

    // Check if element has visible text content
    const hasVisibleText = targetElement.textContent.trim().length > 0;

    // Check if it's likely an icon-only element (has icon but NO text)
    const hasIcon =
      targetElement.querySelector('svg, i, [class*="icon"]') ||
      targetElement.classList.toString().toLowerCase().includes('icon') ||
      targetElement.tagName === 'SVG';

    // Only apply 24x24px rule to icon-only buttons (without text)
    // Buttons with text are judged by text size, not icon size
    const isIconOnlyButton = hasIcon && !hasVisibleText;
    const isEmptyClickable = !hasVisibleText && isClickable;

    if (isIconOnlyButton || isEmptyClickable) {
      if (width < 24 || height < 24) {
        errors.push({
          element: targetElement,
          message: `Clickable element too small: ${width.toFixed(
            0
          )}x${height.toFixed(0)}px (min: 24x24px)`,
        });
        count++;
      }
    }
  });

  return count;
}

function checkEmptyElements(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    // Check if element is or appears clickable
    const isClickable =
      element.matches('button, a, [onclick], [role="button"]') ||
      element.style.cursor === 'pointer' ||
      window.getComputedStyle(element).cursor === 'pointer';

    if (!isClickable) return;

    // Get dimensions
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Only report if element is truly empty (0x0)
    if (width === 0 || height === 0) {
      const tagName = element.tagName.toLowerCase();
      const className = element.className
        ? `.${element.className.split(' ')[0]}`
        : '';

      errors.push({
        element: element,
        message: `Empty clickable element: <${tagName}${className}> is 0x0px (likely layout element)`,
      });
      count++;
    }
  });

  return count;
}

// ===== ADVANCED ACCESSIBILITY CHECKS =====

// Helper function to get element HTML for debugging
function getElementHTML(element, maxLength = 200) {
  try {
    let html = element.outerHTML;

    // If too long, truncate but keep structure visible
    if (html.length > maxLength) {
      const tagMatch = html.match(/^<([^\s>]+)([^>]*)>/);
      if (tagMatch) {
        const tagName = tagMatch[1];
        const attrs = tagMatch[2];
        const closingTag = `</${tagName}>`;
        const availableLength =
          maxLength - tagName.length - closingTag.length - 10;

        if (attrs.length > availableLength) {
          return `<${tagName}${attrs.substring(
            0,
            availableLength
          )}...${closingTag}`;
        }
        return `<${tagName}${attrs}>...${closingTag}`;
      }
      return html.substring(0, maxLength) + '...';
    }

    return html;
  } catch (e) {
    return `<${element.tagName.toLowerCase()} class="${element.className}">`;
  }
}

function checkFocusVisible(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    const isInteractive = element.matches(
      'a, button, input, select, textarea, [tabindex], [role="button"], [role="link"]'
    );

    if (!isInteractive) return;

    const style = window.getComputedStyle(element);
    const outlineStyle = style.outline;
    const outlineWidth = parseFloat(style.outlineWidth);

    // Check if outline is explicitly disabled
    if (
      outlineStyle === 'none' ||
      outlineWidth === 0 ||
      style.outlineColor === 'transparent'
    ) {
      // Check if there's an alternative focus indicator (box-shadow, border change, etc.)
      // This is a simplified check - in reality, focus styles might be applied via :focus
      const hasShadow = style.boxShadow && style.boxShadow !== 'none';

      if (!hasShadow) {
        errors.push({
          element: element,
          message: `Focus indicator disabled: Element has outline:none without alternative focus style`,
        });
        count++;
      }
    }
  });

  return count;
}

function checkTabOrder(elements, errors) {
  let count = 0;
  const positiveTabIndexElements = [];

  elements.forEach((element) => {
    const tabindex = element.getAttribute('tabindex');

    if (tabindex !== null) {
      const tabindexValue = parseInt(tabindex);

      // Positive tabindex is considered bad practice
      if (tabindexValue > 0) {
        positiveTabIndexElements.push(element);
        errors.push({
          element: element,
          message: `Bad tabindex: tabindex="${tabindex}" (positive values disrupt natural tab order)`,
        });
        count++;
      }

      // tabindex="0" on non-interactive elements
      if (
        tabindexValue === 0 &&
        !element.matches(
          'a, button, input, select, textarea, [role="button"], [role="link"]'
        )
      ) {
        errors.push({
          element: element,
          message: `Questionable tabindex: Non-interactive element with tabindex="0"`,
        });
        count++;
      }
    }
  });

  return count;
}

function checkAltText(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    // Check images
    if (element.tagName === 'IMG') {
      const alt = element.getAttribute('alt');
      const role = element.getAttribute('role');

      // Missing alt attribute entirely
      if (alt === null && role !== 'presentation' && role !== 'none') {
        errors.push({
          element: element,
          message: `Missing alt: <img> without alt attribute`,
        });
        count++;
      }
      // Empty alt on image that seems informative (has src with meaningful name)
      else if (alt === '' && role !== 'presentation') {
        const src = element.src || '';
        if (
          !src.includes('spacer') &&
          !src.includes('blank') &&
          !src.includes('pixel')
        ) {
          errors.push({
            element: element,
            message: `Empty alt: Potentially informative image with alt=""`,
          });
          count++;
        }
      }
    }

    // Check SVGs
    if (element.tagName === 'SVG') {
      const role = element.getAttribute('role');
      const ariaLabel = element.getAttribute('aria-label');
      const ariaLabelledby = element.getAttribute('aria-labelledby');
      const ariaHidden = element.getAttribute('aria-hidden');
      const title = element.querySelector('title');

      // Informative SVG without accessible name
      if (
        !ariaHidden &&
        !role &&
        !ariaLabel &&
        !ariaLabelledby &&
        !title &&
        !element.closest('button')
      ) {
        errors.push({
          element: element,
          message: `SVG accessibility: SVG without role="img" or aria-label`,
        });
        count++;
      }
    }

    // Check icon fonts/elements
    if (
      element.tagName === 'I' ||
      element.classList.toString().toLowerCase().includes('icon')
    ) {
      const ariaHidden = element.getAttribute('aria-hidden');
      const ariaLabel = element.getAttribute('aria-label');
      const hasText = element.textContent.trim().length > 0;
      const parentButton = element.closest('button, a, [role="button"]');

      // Check if this element has icon children that would be reported instead
      const hasIconChildren = Array.from(element.children).some((child) => {
        return (
          child.tagName === 'I' ||
          child.classList.toString().toLowerCase().includes('icon')
        );
      });

      // Skip parent containers if they have icon children - report the child instead
      // This prevents duplicate errors for nested icon elements
      if (hasIconChildren) {
        return;
      }

      // Check element dimensions - empty icon containers might have 0x0 size
      const rect = element.getBoundingClientRect();
      const isEmpty = rect.width === 0 || rect.height === 0;

      // Determine if icon should be decorative (aria-hidden)
      // Icon should be hidden if:
      // 1. It's truly decorative (icon that just reinforces the text visually)
      // 2. It's standalone without semantic meaning
      let shouldBeHidden = false;

      if (parentButton) {
        // Check if button has text content (excluding the icon itself)
        const buttonText = parentButton.textContent
          .replace(element.textContent, '')
          .trim();

        // Icon is decorative ONLY if:
        // - Button has text AND
        // - Icon is truly decorative (not chevrons, arrows, status icons)
        const iconName = element.className.toLowerCase();
        const isFunctionalIcon =
          iconName.includes('chevron') ||
          iconName.includes('arrow') ||
          iconName.includes('expand') ||
          iconName.includes('collapse') ||
          iconName.includes('dropdown') ||
          iconName.includes('caret') ||
          element
            .getAttribute('name')
            ?.match(/chevron|arrow|expand|collapse|caret|dropdown/i);

        // Only mark as decorative if button has text AND icon is NOT functional
        shouldBeHidden = buttonText.length > 0 && !isFunctionalIcon;
      }

      // Special case: Empty icon container (e.g., icon-start without actual icon)
      if (isEmpty && !hasText && !hasIconChildren) {
        // This is likely a placeholder for an icon that was never added
        errors.push({
          element: element,
          message: `Icon accessibility: Empty icon container (no icon, 0x0px) - remove or add icon`,
          html: getElementHTML(element),
        });
        count++;
        return;
      }

      // Icon without proper attributes
      if (!ariaHidden && !ariaLabel && !hasText) {
        // Skip if icon is inside a button without text (icon is the button's purpose)
        if (parentButton && !shouldBeHidden) {
          return; // Icon-only button - the button itself will be checked for size
        }

        const parentHTML = parentButton
          ? getElementHTML(parentButton, 150)
          : '';

        errors.push({
          element: element,
          message: shouldBeHidden
            ? `Icon accessibility: Decorative icon without aria-hidden="true"`
            : `Icon accessibility: Icon without aria-label or text content`,
          html: getElementHTML(element),
          parentHTML: parentHTML,
        });
        count++;
      }
    }
  });

  return count;
}

function checkFormLabels(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    if (element.matches('input:not([type="hidden"]), select, textarea')) {
      const id = element.id;
      const ariaLabel = element.getAttribute('aria-label');
      const ariaLabelledby = element.getAttribute('aria-labelledby');
      const type = element.getAttribute('type');

      // Skip buttons and submit inputs
      if (type === 'button' || type === 'submit' || type === 'reset') return;

      // Check for associated label
      let hasLabel = false;

      if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) hasLabel = true;
      }

      // Check if input is inside a label
      if (!hasLabel && element.closest('label')) {
        hasLabel = true;
      }

      // Check ARIA
      if (ariaLabel || ariaLabelledby) {
        hasLabel = true;
      }

      if (!hasLabel) {
        const placeholder = element.getAttribute('placeholder');
        if (placeholder) {
          errors.push({
            element: element,
            message: `Form label issue: Input has placeholder but no <label> (placeholders are not labels)`,
          });
        } else {
          errors.push({
            element: element,
            message: `Missing label: Form input without associated <label> or aria-label`,
          });
        }
        count++;
      }

      // Check for required indication
      if (
        element.hasAttribute('required') ||
        element.getAttribute('aria-required') === 'true'
      ) {
        const hasVisualIndicator =
          element.closest('.required') ||
          element.parentElement.textContent.includes('*') ||
          element.parentElement.querySelector('[aria-label*="required"]');

        if (!hasVisualIndicator) {
          errors.push({
            element: element,
            message: `Required field: Input is required but lacks visual indicator (e.g., asterisk)`,
          });
          count++;
        }
      }
    }
  });

  return count;
}

function checkHeadingsStructure(elements, errors) {
  let count = 0;
  const headings = [];

  // Collect all headings with their levels
  elements.forEach((element) => {
    const match = element.tagName.match(/^H([1-6])$/);
    if (match) {
      headings.push({
        element: element,
        level: parseInt(match[1]),
        text: element.textContent.trim(),
      });
    }
  });

  // Check for empty headings
  headings.forEach((heading) => {
    if (!heading.text) {
      errors.push({
        element: heading.element,
        message: `Empty heading: <${heading.element.tagName.toLowerCase()}> has no text content`,
      });
      count++;
    }
  });

  // Check for skipped heading levels
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const curr = headings[i];

    if (curr.level > prev.level + 1) {
      errors.push({
        element: curr.element,
        message: `Heading skip: Jumped from <h${prev.level}> to <h${
          curr.level
        }> (skipped h${prev.level + 1})`,
      });
      count++;
    }
  }

  // Check for multiple H1s
  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length > 1) {
    h1s.slice(1).forEach((h1) => {
      errors.push({
        element: h1.element,
        message: `Multiple H1: Page should have only one <h1> element`,
      });
      count++;
    });
  }

  return count;
}

function checkKeyboardTraps(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    // Check for hidden focusable elements
    const isFocusable = element.matches(
      'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (isFocusable) {
      const style = window.getComputedStyle(element);
      const isHidden =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        element.hasAttribute('hidden');

      if (isHidden) {
        errors.push({
          element: element,
          message: `Keyboard trap: Focusable element is hidden (display:none or visibility:hidden)`,
        });
        count++;
      }

      // Check for elements with very negative position (off-screen)
      const rect = element.getBoundingClientRect();
      if (rect.top < -1000 || rect.left < -1000) {
        // Only report if it doesn't have aria-hidden or role=presentation
        if (
          !element.getAttribute('aria-hidden') &&
          element.getAttribute('role') !== 'presentation'
        ) {
          errors.push({
            element: element,
            message: `Off-screen focusable: Element is focusable but positioned far off-screen`,
          });
          count++;
        }
      }
    }
  });

  return count;
}

function checkHiddenContent(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    const style = window.getComputedStyle(element);
    const ariaHidden = element.getAttribute('aria-hidden');
    const isVisuallyHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      element.hasAttribute('hidden');

    // Case 1: Visually hidden but accessible to screen readers (should have aria-hidden="true")
    if (isVisuallyHidden && ariaHidden !== 'true') {
      // Check if element has focusable children
      const focusableChildren = element.querySelectorAll(
        'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (focusableChildren.length > 0) {
        errors.push({
          element: element,
          message: `Hidden content issue: Hidden container has focusable elements (potential keyboard trap)`,
        });
        count++;
      }
    }

    // Case 2: aria-hidden="true" but element is visible and interactive
    if (ariaHidden === 'true' && !isVisuallyHidden) {
      const isInteractive = element.matches(
        'button, a, input, select, textarea, [role="button"]'
      );

      if (isInteractive) {
        errors.push({
          element: element,
          message: `aria-hidden conflict: Interactive element has aria-hidden="true" (will confuse screen readers)`,
        });
        count++;
      }
    }
  });

  return count;
}

function checkColorDependence(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    const text = element.textContent.trim().toLowerCase();
    const style = window.getComputedStyle(element);
    const color = style.color;

    // Check for red text indicating errors without other indicators
    if (
      color.includes('rgb(255') ||
      color.includes('#ff') ||
      color.includes('#f00') ||
      color.includes('red')
    ) {
      // Check if text mentions error/required/invalid
      if (
        text.includes('error') ||
        text.includes('required') ||
        text.includes('invalid') ||
        text === '*'
      ) {
        // Check if there's an icon or aria-label
        const hasIcon = element.querySelector('svg, i, [class*="icon"]');
        const hasAria = element.getAttribute('aria-label');

        if (!hasIcon && !hasAria) {
          errors.push({
            element: element,
            message: `Color dependence: Error/required indicator relies only on red color`,
          });
          count++;
        }
      }
    }

    // Check for links differentiated only by color
    if (element.tagName === 'A') {
      const textDecoration = style.textDecoration;
      const fontWeight = style.fontWeight;

      if (!textDecoration.includes('underline') && parseInt(fontWeight) < 600) {
        errors.push({
          element: element,
          message: `Link styling: Link may be distinguished only by color (add underline or other visual cue)`,
        });
        count++;
      }
    }
  });

  return count;
}

function checkLanguage(elements, errors) {
  let count = 0;

  // Check html lang attribute (only once for the document)
  if (elements.length > 0) {
    const htmlLang = document.documentElement.getAttribute('lang');
    if (!htmlLang) {
      // Report on first element as a proxy
      errors.push({
        element: elements[0],
        message: `Missing language: <html> element has no lang attribute`,
      });
      count++;
    }
  }

  // Check for content in different languages without lang attribute
  elements.forEach((element) => {
    const text = element.textContent.trim();

    // Simple heuristic: check for common foreign language patterns
    // This is very basic - real implementation would need more sophisticated detection
    if (text.length > 20) {
      const lang = element.getAttribute('lang');
      const htmlLang = document.documentElement.getAttribute('lang');

      // Check if element explicitly sets a different language
      if (lang && lang !== htmlLang && lang !== htmlLang?.split('-')[0]) {
        // This is actually correct - just noting it
        return;
      }

      // Check for obvious language switches without lang attribute
      // Example: Cyrillic, Chinese, Arabic characters
      const hasCyrillic = /[\u0400-\u04FF]/.test(text);
      const hasChinese = /[\u4E00-\u9FFF]/.test(text);
      const hasArabic = /[\u0600-\u06FF]/.test(text);

      if (
        (hasCyrillic || hasChinese || hasArabic) &&
        !lang &&
        htmlLang === 'en'
      ) {
        errors.push({
          element: element,
          message: `Language mismatch: Text appears to be in different language but no lang attribute set`,
        });
        count++;
      }
    }
  });

  return count;
}

function checkLinkText(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    if (element.tagName === 'A') {
      const text = element.textContent.trim().toLowerCase();
      const ariaLabel = element.getAttribute('aria-label');
      const ariaLabelledby = element.getAttribute('aria-labelledby');

      // Get effective text
      const effectiveText = ariaLabel || text;

      // Check for generic link text
      const genericPhrases = [
        'click here',
        'read more',
        'more',
        'link',
        'here',
        'this',
        'más info',
        'más información',
        'haz clic aquí',
        'pulsa aquí',
        'ver más',
      ];

      if (genericPhrases.includes(effectiveText)) {
        errors.push({
          element: element,
          message: `Non-descriptive link: "${effectiveText}" doesn't describe destination (use descriptive text)`,
        });
        count++;
      }

      // Check for empty links
      if (!effectiveText && !ariaLabelledby) {
        // Check if link contains only images
        const hasImage = element.querySelector('img, svg');
        if (hasImage) {
          errors.push({
            element: element,
            message: `Empty link text: Link contains only images without alt text or aria-label`,
          });
          count++;
        } else {
          errors.push({
            element: element,
            message: `Empty link: Link has no text content or aria-label`,
          });
          count++;
        }
      }
    }
  });

  return count;
}

function checkColorContrast(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    const computedStyle = window.getComputedStyle(element);
    const color = computedStyle.color;
    const backgroundColor = getBackgroundColor(element);

    if (!backgroundColor || backgroundColor === 'transparent') return;

    const contrastRatio = getContrastRatio(color, backgroundColor);

    if (contrastRatio === null) return;

    // Check text contrast
    const hasText =
      element.textContent.trim().length > 0 && element.children.length === 0;
    if (hasText) {
      const fontSize = parseFloat(computedStyle.fontSize);
      const isBold = computedStyle.fontWeight >= 700;
      const isLargeText = fontSize >= 18 || (fontSize >= 14 && isBold);

      const minRatio = isLargeText ? 3 : 4.5;

      if (contrastRatio < minRatio) {
        errors.push({
          element: element,
          message: `Poor text contrast: ${contrastRatio.toFixed(
            2
          )}:1 (min: ${minRatio}:1)`,
        });
        count++;
      }
    }
  });

  return count;
}

function checkBorderContrast(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    const computedStyle = window.getComputedStyle(element);
    const backgroundColor = getBackgroundColor(element);

    if (!backgroundColor || backgroundColor === 'transparent') return;

    // Check border contrast
    const borderColor = computedStyle.borderColor;
    if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)') {
      const borderWidth = parseFloat(computedStyle.borderWidth);
      if (borderWidth > 0) {
        const borderContrast = getContrastRatio(borderColor, backgroundColor);
        if (borderContrast !== null && borderContrast < 3) {
          errors.push({
            element: element,
            message: `Poor border contrast: ${borderContrast.toFixed(
              2
            )}:1 (min: 3:1)`,
          });
          count++;
        }
      }
    }
  });

  return count;
}

function checkAriaLabels(elements, errors) {
  let count = 0;

  elements.forEach((element) => {
    // Elements that should have aria-label or accessible name
    const needsLabel = element.matches(
      'button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"]'
    );

    if (!needsLabel) return;

    const hasAriaLabel =
      element.hasAttribute('aria-label') ||
      element.hasAttribute('aria-labelledby') ||
      element.hasAttribute('title');

    const hasTextContent = element.textContent.trim().length > 0;
    const hasAltText = element.hasAttribute('alt');

    // Special case for inputs
    if (
      element.tagName === 'INPUT' ||
      element.tagName === 'SELECT' ||
      element.tagName === 'TEXTAREA'
    ) {
      const hasAssociatedLabel = element.labels && element.labels.length > 0;
      if (!hasAriaLabel && !hasAssociatedLabel && !element.placeholder) {
        errors.push({
          element: element,
          message: 'Form element missing accessible label',
        });
        count++;
      }
      return;
    }

    // For other interactive elements
    if (!hasAriaLabel && !hasTextContent && !hasAltText) {
      errors.push({
        element: element,
        message: 'Interactive element missing aria-label or text content',
      });
      count++;
    }
  });

  return count;
}

function highlightError(element, message) {
  // Add error class and outline to element
  element.classList.add('a11y-has-error');
  element.style.outline = '2px dashed #ff4444';
  element.style.outlineOffset = '2px';

  // Check if element already has errors
  const existingLabel = element.getAttribute('data-a11y-label-id');
  if (existingLabel) {
    const label = document.getElementById(existingLabel);
    if (label) {
      // Append message to existing label
      const separator = document.createElement('div');
      separator.style.borderTop = '1px solid rgba(255, 255, 255, 0.3)';
      separator.style.margin = '4px 0';
      label.appendChild(separator);

      const newMessage = document.createElement('div');
      newMessage.textContent = message;
      label.appendChild(newMessage);
      return;
    }
  }

  // Create floating error message
  const errorLabel = document.createElement('div');
  const labelId = 'a11y-label-' + Math.random().toString(36).substr(2, 9);
  errorLabel.id = labelId;
  errorLabel.className = 'a11y-error-highlight';

  // Create message span
  const messageSpan = document.createElement('span');
  messageSpan.textContent = message;
  errorLabel.appendChild(messageSpan);

  // Create close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'a11y-error-close-btn';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close error popup');
  closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    errorLabel.style.display = 'none';
    // Don't remove from DOM completely, just hide it
    // This keeps the error in the report
  });
  errorLabel.appendChild(closeBtn);

  // Link element to its label
  element.setAttribute('data-a11y-label-id', labelId);

  // Position the error label
  const rect = element.getBoundingClientRect();

  // Check if element has valid position (not 0x0 at origin)
  let labelLeft = rect.left + window.scrollX;
  let labelTop = rect.top + window.scrollY - 30;

  // If element is at 0,0 or has no dimensions, try to find a better position
  if (
    (rect.left === 0 && rect.top === 0) ||
    (rect.width === 0 && rect.height === 0)
  ) {
    // Try to use parent element's position
    const parent = element.parentElement;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      labelLeft = parentRect.left + window.scrollX;
      labelTop = parentRect.top + window.scrollY - 30;
    }
  }

  errorLabel.style.position = 'absolute';
  errorLabel.style.left = labelLeft + 'px';
  errorLabel.style.top = labelTop + 'px';
  errorLabel.style.zIndex = '10000';

  document.body.appendChild(errorLabel);

  // Check for overlapping labels and adjust position
  adjustOverlappingLabels(errorLabel);

  // Reposition on scroll
  const repositionLabel = () => {
    const newRect = element.getBoundingClientRect();
    let newLeft = newRect.left + window.scrollX;
    let newTop = newRect.top + window.scrollY - 30;

    // Re-check position validity
    if (
      (newRect.left === 0 && newRect.top === 0) ||
      (newRect.width === 0 && newRect.height === 0)
    ) {
      const parent = element.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        newLeft = parentRect.left + window.scrollX;
        newTop = parentRect.top + window.scrollY - 30;
      }
    }

    errorLabel.style.left = newLeft + 'px';
    errorLabel.style.top = newTop + 'px';

    // Re-check overlaps after repositioning
    adjustOverlappingLabels(errorLabel);
  };

  window.addEventListener('scroll', repositionLabel);
  window.addEventListener('resize', repositionLabel);
}

// Adjust overlapping labels by stacking them vertically
function adjustOverlappingLabels(newLabel) {
  const allLabels = document.querySelectorAll('.a11y-error-highlight');
  const newRect = newLabel.getBoundingClientRect();
  const STACK_OFFSET = 35; // Pixels to offset when stacking

  let overlaps = [];

  allLabels.forEach((label) => {
    if (label === newLabel) return;

    const labelRect = label.getBoundingClientRect();

    // Check if labels overlap
    const isOverlapping = !(
      newRect.right < labelRect.left ||
      newRect.left > labelRect.right ||
      newRect.bottom < labelRect.top ||
      newRect.top > labelRect.bottom
    );

    if (isOverlapping) {
      overlaps.push({
        element: label,
        top: parseInt(label.style.top) || labelRect.top + window.scrollY,
      });
    }
  });

  // If there are overlaps, stack the new label below
  if (overlaps.length > 0) {
    // Find the lowest label
    const lowestOverlap = overlaps.reduce((lowest, current) => {
      return current.top > lowest.top ? current : lowest;
    });

    // Position new label below the lowest overlapping label
    const lowestRect = lowestOverlap.element.getBoundingClientRect();
    const newTop = lowestOverlap.top + lowestRect.height + 5; // 5px gap
    newLabel.style.top = newTop + 'px';
  }
}

// Utility functions for contrast calculation
function getBackgroundColor(element) {
  let bgColor = window.getComputedStyle(element).backgroundColor;

  // If transparent, walk up the tree
  if (bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
    let parent = element.parentElement;
    while (parent) {
      bgColor = window.getComputedStyle(parent).backgroundColor;
      if (bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
        return bgColor;
      }
      parent = parent.parentElement;
    }
    return 'rgb(255, 255, 255)'; // Default to white
  }

  return bgColor;
}

function getContrastRatio(color1, color2) {
  try {
    const rgb1 = parseRGB(color1);
    const rgb2 = parseRGB(color2);

    if (!rgb1 || !rgb2) return null;

    const l1 = getRelativeLuminance(rgb1);
    const l2 = getRelativeLuminance(rgb2);

    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);

    return (lighter + 0.05) / (darker + 0.05);
  } catch (e) {
    return null;
  }
}

function parseRGB(colorString) {
  const match = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return {
      r: parseInt(match[1]),
      g: parseInt(match[2]),
      b: parseInt(match[3]),
    };
  }
  return null;
}

function getRelativeLuminance(rgb) {
  const rsRGB = rgb.r / 255;
  const gsRGB = rgb.g / 255;
  const bsRGB = rgb.b / 255;

  const r =
    rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const g =
    gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const b =
    bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ===== AUTO-CLEANUP ON PAGE NAVIGATION =====
// Clear highlights when navigating to a new page
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log('Page navigation detected, clearing highlights');
    clearHighlights();
  }
}).observe(document, { subtree: true, childList: true });
