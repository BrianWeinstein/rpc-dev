import React, { useState, useEffect, useRef } from 'react';

// Custom easing function for ease-out quadratic with a minimum speed factor
// t: normalized time (0 to 1) within the easing segment
// minFactor: the minimum speed as a fraction of the linear speed (e.g., 0.15 for 15%)
const easeOutQuadWithMinSpeed = (t, minFactor) => {
  const easedT = 1 - Math.pow(1 - t, 2); // Original easeOutQuad (starts fast, ends at 0 speed)
  // Blend the eased progress with linear progress, scaled by minFactor
  // This ensures the speed never drops below minFactor * linear speed
  return easedT * (1 - minFactor) + t * minFactor;
};


// Main App component
const App = () => {
  // console.log('App component rendered');

  // State for the data URL of the original image (cropped square version)
  const [originalImageDataUrl, setOriginalImageDataUrl] = useState(null);
  // State for the data URL of the last image that was processed (for retry)
  const [lastProcessedImageDataUrl, setLastProcessedImageDataUrl] = useState(null);

  // State for the generated image URL (Standard Quality)
  const [generatedImageUrlStandard, setGeneratedImageUrlStandard] = useState(null);

  // State to control the opacity of the generated images for fade-in effect
  const [generatedImageOpacity, setGeneratedImageOpacity] = useState(0);

  // Loading state for the entire process (description + image generation)
  const [isProcessing, setIsProcessing] = useState(false);

  // State for overall error messages
  const [errorMessage, setErrorMessage] = useState('');

  // State for continuous progress (0 to 100)
  const [progress, setProgress] = useState(0);
  // Ref to store the interval ID for the progress bar animation
  const progressIntervalRef = useRef(null);
  // Ref to store the AbortController for API calls
  const abortControllerRef = useRef(null);

  // State to control side-by-side comparison view (now for original and one generated image)
  const [showSideBySide, setShowSideBySide] = useState(false);

  // Debug mode state: default to false upon load
  const [isDebugMode, setIsDebugMode] = useState(false);


  // Refs for canvas and the loaded original image
  const canvasRef = useRef(null);
  const originalImageRef = useRef(null); // To hold the loaded original Image object

  // --- CAMERA STATES AND REFS ---
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [isCaptureReady, setIsCaptureReady] = useState(false); // State for capture button readiness
  const videoRef = useRef(null);
  // State to track current camera facing mode: 'user' for front, 'environment' for rear
  const [facingMode, setFacingMode] = useState('environment'); // Default to rear camera
  // --- END CAMERA STATES AND REFS ---

  // State for the generated description text
  const [descriptionText, setDescriptionText] = useState('');

  // Refs for progress bar animation logic
  const processStartTimeRef = useRef(null);
  const randomSlowDownPointRef = useRef(null);
  const preFinishProgressRef = useRef(0);

  // Define the target aspect ratio (width / height)
  const TARGET_ASPECT_RATIO = 0.7; // This is 7:10 (width:height)

  // Function to draw the loading effect on the canvas (combining pixelation, color quantization, and scanlines)
  // Now accepts 'sourceElement' which can be an Image or Video
  const drawLoadingEffect = (ctx, sourceElement, currentProgress) => {
    // Check if context, source element, and canvas are ready
    if (!ctx || !sourceElement || !canvasRef.current) {
      return;
    }
    // Check specific readiness for Image or Video
    if (sourceElement instanceof HTMLImageElement && !sourceElement.complete) {
        return;
    }
    if (sourceElement instanceof HTMLVideoElement && sourceElement.readyState < 2) { // readyState 2 means enough data for first frame
        return;
    }

    const canvas = canvasRef.current;

    // Set canvas dimensions to match the display size of its parent container
    const parentDiv = canvas.parentNode;
    if (parentDiv) {
      canvas.width = parentDiv.clientWidth;
      canvas.height = parentDiv.clientHeight;
    }

    ctx.imageSmoothingEnabled = false; // Crucial for crisp pixelation

    // Clear canvas before drawing new frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Use the actual dimensions of the source element
    const sourceWidth = sourceElement.videoWidth || sourceElement.width;
    const sourceHeight = sourceElement.videoHeight || sourceElement.height;

    // Ensure source has valid dimensions
    if (sourceWidth === 0 || sourceHeight === 0) return;

    // Calculate source rectangle to crop the center TARGET_ASPECT_RATIO
    let sx, sy, sWidth, sHeight;

    const sourceAspectRatio = sourceWidth / sourceHeight;

    if (sourceAspectRatio > TARGET_ASPECT_RATIO) { // Source is wider than TARGET_ASPECT_RATIO
      sHeight = sourceHeight;
      sWidth = sourceHeight * TARGET_ASPECT_RATIO;
      sx = (sourceWidth - sWidth) / 2;
      sy = 0;
    } else { // Source is taller or TARGET_ASPECT_RATIO
      sWidth = sourceWidth;
      sHeight = sourceWidth / TARGET_ASPECT_RATIO;
      sx = 0;
      sy = (sourceHeight - sHeight) / 2;
    }


    // tempCanvas will now be TARGET_ASPECT_RATIO, representing the cropped source
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    const desiredTempWidth = 1024; // Arbitrary high resolution for pixel sampling
    const desiredTempHeight = Math.round((1/TARGET_ASPECT_RATIO) * desiredTempWidth);
    tempCanvas.width = desiredTempWidth;
    tempCanvas.height = desiredTempHeight;

    // Draw the cropped section of the source onto the temp canvas, scaling it to desiredTempSize x desiredTempSize
    tempCtx.drawImage(
      sourceElement,
      sx,         // sx: x-coordinate of the top-left corner of the source rectangle
      sy,         // sy: y-coordinate of the top-left corner of the source rectangle
      sWidth,     // sWidth: width of the source rectangle
      sHeight,    // sHeight: height of the source rectangle
      0,          // dx: x-coordinate of the top-left corner of the destination rectangle
      0,          // dy: y-coordinate of the top-left corner of the destination rectangle
      desiredTempWidth, // dWidth: width of the destination rectangle
      desiredTempHeight  // dHeight: height of the destination rectangle
    );

    const normalizedProgress = currentProgress / 100;

    // --- Color Quantization Progression (Option 4) ---
    const maxColorStep = 64; // Coarsest quantization (e.g., 4 distinct values per channel)
    const minColorStep = 16; // Finest quantization (e.g., 16 distinct values per channel)
    const colorStep = maxColorStep - (normalizedProgress * (maxColorStep - minColorStep));
    const effectiveColorStep = Math.max(minColorStep, Math.floor(colorStep));

    // Fixed block size for the base pixel grid (relative to the display canvas size)
    const fixedBlockSize = Math.max(1, Math.floor(canvas.width / 40)); // Adjust block size based on display width
    if (fixedBlockSize === 0) return; // Avoid infinite loop if canvas width is 0

    // Draw the pixelated image with quantized colors onto the *display* canvas
    for (let y = 0; y < canvas.height; y += fixedBlockSize) {
      for (let x = 0; x < canvas.width; x += fixedBlockSize) {
        // Map display canvas coordinates back to the original source coordinates for color sampling
        // This is based on the tempCanvas dimensions (which reflect the source's native resolution)
        const imgX = Math.floor((x / canvas.width) * tempCanvas.width);
        const imgY = Math.floor((y / canvas.height) * tempCanvas.height);

        // Get pixel data from the temporary high-res canvas
        const pixelData = tempCtx.getImageData(imgX, imgY, 1, 1).data;

        // Quantize the color
        const r = Math.floor(pixelData[0] / effectiveColorStep) * effectiveColorStep;
        const g = Math.floor(pixelData[1] / effectiveColorStep) * effectiveColorStep;
        const b = Math.floor(pixelData[2] / effectiveColorStep) * effectiveColorStep;

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x, y, fixedBlockSize, fixedBlockSize);
      }
    }

    // --- Scanline/Data Stream Effect (Option 2) ---
    // Opacity of scanlines decreases as progress increases
    const scanlineOpacity = 0.15 * (1 - normalizedProgress); // Starts at 0.15, fades to 0
    if (scanlineOpacity > 0.01) { // Only draw if visibly opaque
      ctx.strokeStyle = `rgba(0, 0, 0, ${scanlineOpacity})`; // Black scanlines
      ctx.lineWidth = 1;

      for (let y = 0; y < canvas.height; y += 5) { // Draw a line every 5 pixels
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5); // +0.5 for crisp lines
        ctx.lineTo(canvas.width, y + 0.5);
        ctx.stroke();
      }
    }
  };

  // Function to handle the full process: describe then generate image
  const handleGenerateImageProcess = async (fileDataUrl) => {
    console.log('handleGenerateImageProcess called.');
    setIsProcessing(true); // Start the processing state, which triggers progress animation
    setProgress(0); // Reset progress to 0 on retry
    setErrorMessage('');
    setGeneratedImageUrlStandard(null); // Clear previous standard generated image
    setGeneratedImageOpacity(0); // Ensure generated image is hidden at start of process
    setShowSideBySide(false); // Hide side-by-side view when starting new process
    setDescriptionText(''); // Clear previous description when starting a new process
    setLastProcessedImageDataUrl(fileDataUrl); // Store the image data for retry

    // Explicitly clear canvas and hide generated image for immediate visual reset
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setGeneratedImageOpacity(0);

    console.log('States reset for new processing cycle.');

    // Create a new AbortController for this process
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    let description = ''; // Variable to hold the description internally

    try {
      // --- Step 1: Describe the photo (API call) ---
      console.log('Starting Step 1: Describing the photo...');
      const [mimeType, base64Data] = fileDataUrl.split(';base64,');
      const imageMimeType = mimeType.split(':')[1];
      console.log('Image MIME type:', imageMimeType);

      const describePrompt = `Describe this photo in great detail. Do not mention notable people or landmarks by name. If people appear in the photo, describe their apperances (skin tone, facial features, etc.) in detail.`;
      const describePayload = {
        contents: [
          {
            role: "user",
            parts: [
              { text: describePrompt },
              {
                inlineData: {
                  mimeType: imageMimeType,
                  data: base64Data
                }
              }
            ]
          }
        ],
      };
      console.log('Description API payload prepared.');

      const apiKey = typeof __app_id !== 'undefined' ? "" : import.meta.env.VITE_GEMINI_API_KEY;

      const describeApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      console.log('Calling Description API:', describeApiUrl);

      const describeResponse = await fetch(describeApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(describePayload),
        signal: signal // Pass the abort signal
      });

      // Check if aborted after fetch completes
      if (signal.aborted) {
        console.log('Description API fetch aborted by user.');
        return; // Exit early if cancelled
      }

      console.log('Description API response received. Status:', describeResponse.status);

      if (!describeResponse.ok) {
        let errorText = describeResponse.statusText;
        try {
          const errorData = await describeResponse.json();
          errorText = errorData.error?.message || JSON.stringify(errorData);
        } catch (e) {
          errorText = await describeResponse.text(); // Fallback to raw text if JSON parsing fails
          console.error("Failed to parse error JSON for description API:", e, "Raw response:", errorText);
        }
        if (describeResponse.status === 401) {
            throw new Error(`Description API error (401 Unauthorized): Please check your API key and ensure the Gemini API is enabled for your Google Cloud project.`);
        }
        throw new Error(`Description API error (${describeResponse.status}): ${errorText}`);
      }

      const describeResult = await describeResponse.json();
      console.log('Description API result:', describeResult);

      if (describeResult.candidates && describeResult.candidates.length > 0 &&
          describeResult.candidates[0].content && describeResult.candidates[0].content.parts &&
          describeResult.candidates[0].content.parts.length > 0) {
        description = describeResult.candidates[0].content.parts[0].text;
        setDescriptionText(description); // Set the description text state
        console.log('Generated description:', description);
      } else {
        throw new Error('No description received from Gemini. Response was: ' + JSON.stringify(describeResult));
      }

      // --- Step 2: Generate image based on description (Single API call) ---
      console.log('Starting Step 2: Generating image (Standard Quality)...');
      const generatePrompt = description.replace(/[^a-zA-Z0-9\s.,!?'"-]/g, ''); // Sanitize
      console.log('Sanitized generation prompt:', generatePrompt);

      // Modified generateImage function - now takes no arguments
      const generateImage = async () => {
        const modelId = 'imagen-3.0-generate-002'; // Hardcoded model ID
        const generatePayload = { instances: { prompt: generatePrompt }, parameters: { "sampleCount": 1, "aspectRatio": "3:4", "personGeneration": "allow_all", "safetySetting":"block_low_and_above"} }; // Using "7:10" for consistency
        const generateApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predict?key=${apiKey}`;
        console.log(`Calling Image Generation API (${modelId}):`, generateApiUrl);

        let response;
        let result;
        let retries = 0;
        const maxRetries = 3;

        while (retries < maxRetries) {
          response = await fetch(generateApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(generatePayload),
            signal: signal // Pass the abort signal
          });

          if (signal.aborted) {
            console.log(`Image Generation API (${modelId}) fetch aborted by user.`);
            return;
          }

          console.log(`Image Generation API (${modelId}) response received. Status: ${response.status} (Attempt ${retries + 1})`);

          if (response.ok) {
            result = await response.json();
            console.log(`Image Generation API (${modelId}) result:`, result);
            break;
          } else if (response.status === 401) {
            console.warn(`401 Unauthorized error for ${modelId}. Retrying...`);
            retries++;
            await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          } else if (response.status === 403) { // Specific handling for 403 Forbidden error
              let errorText = response.statusText;
              try {
                const errorData = await response.json();
                errorText = errorData.error?.message || JSON.stringify(errorData);
              } catch (e) {
                errorText = await response.text();
                console.error(`Failed to parse error JSON for ${modelId}:`, e, "Raw response:", errorText);
              }
              // Make the error message more specific about potential causes
              throw new Error(`Image Generation API (${modelId}) error (403 Forbidden): Access denied. Ensure billing is enabled and the Imagen API is properly enabled in your Google Cloud project for this model. Details: ${errorText}`);
          } else {
            let errorText = response.statusText;
            try {
              const errorData = await response.json();
              errorText = errorData.error?.message || JSON.stringify(errorData);
            } catch (e) {
              errorText = await response.text();
              console.error(`Failed to parse error JSON for ${modelId}:`, e, "Raw response:", errorText);
            }
            throw new Error(`Image Generation API (${modelId}) error (${response.status}): ${errorText}`);
          }
        }

        if (!response.ok && retries === maxRetries) {
            let errorText = response.statusText;
            try {
              const errorData = await response.json();
              errorText = errorData.error?.message || JSON.stringify(errorData);
            }
            catch (e) {
              errorText = await response.text();
            }
            if (response.status === 401) {
                throw new Error(`Image Generation API (${modelId}) error (401 Unauthorized): Max retries exhausted. Please check your API key and ensure the Imagen API is enabled for your Google Cloud project.`);
            } else if (response.status === 403) {
                 throw new Error(`Image Generation API (${modelId}) error (403 Forbidden): Access denied. Max retries exhausted. Ensure billing is enabled and the Imagen API is properly enabled in your Google Cloud project for this model. Details: ${errorText}`);
            }
            throw new Error(`Image Generation API (${modelId}) error (${response.status}): ${errorText}. Max retries exhausted.`);
        }

        if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
          const imageUrl = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
          setGeneratedImageUrlStandard(imageUrl); // Hardcoded setter
          console.log(`Generated image URL set for ${modelId}.`);
        } else {
          throw new Error(`No image generated by ${modelId}. Please try again. Response was: ` + JSON.stringify(result));
        }
      };

      // Call generateImage without arguments
      await generateImage();

      console.log('Image generation process completed.');

    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Process aborted by user.');
      } else {
        console.error('Error during image generation process:', err);
        setErrorMessage(`Process failed: ${err.message}`);
        console.log('Error message set:', err.message);
      }
    } finally {
      // The `finally` block here will execute, but `setIsProcessing(false)` and `setGeneratedImageOpacity(1)`
      // are now managed by the `useEffect` responsible for progress animation.
      // This ensures they are only set when the progress bar truly reaches 100%.
    }
  };

  // Function to handle canceling the process
  const handleCancelProcess = () => {
    // Abort any ongoing fetch requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      console.log('AbortController signal sent.');
    }

    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setIsProcessing(false);
    setProgress(0);
    setErrorMessage('');
    setGeneratedImageUrlStandard(null);
    setGeneratedImageOpacity(0);
    setOriginalImageDataUrl(null); // Clear original image data
    setLastProcessedImageDataUrl(null); // Clear last processed image data
    setDescriptionText('');
    setShowSideBySide(false);
    // Clear canvas
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    console.log('Process cancelled and states reset.');
  };

  // Effect to manage the continuous progress bar animation and pixelation (for processing phase)
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = originalImageRef.current;

    if (isProcessing) {
      // Clear any existing interval to prevent multiple animations running
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }

      // Initialize start time and slowdown point ONLY when a new process begins
      // This ensures they are not reset on subsequent re-renders during processing
      if (processStartTimeRef.current === null) { // Check for null to ensure it's only set once per process
        processStartTimeRef.current = Date.now();
        randomSlowDownPointRef.current = Math.floor(Math.random() * (90 - 75 + 1)) + 75;
        console.log("Random slowdown point set to:", randomSlowDownPointRef.current + "%");
        preFinishProgressRef.current = 0; // Reset for a new run
      }

      // Changed nominalDuration to 15 seconds to make slowdown more perceptible
      const nominalDuration = 15000; // Target 15 seconds for "normal" progress
      const slowDownThreshold = randomSlowDownPointRef.current / 100; // e.g., 0.75 to 0.90
      // Changed minSlowDownFactor to make slowdown more aggressive
      const minSlowDownFactor = 0.01; // Minimum speed as a fraction of original speed (1%)
      const pauseAtProgress = 95; // New: Progress bar will pause at this percentage

      // Constants for pixelation animation during the "waiting" phase
      const animationCycleDuration = 2000; // 2 seconds for one full cycle of pixelation/scanline changes
      const minDrawProgress = 80; // Min 'progress' value for drawing effect during extended wait
      const maxDrawProgress = 95; // Max 'progress' value for drawing effect during extended wait

      progressIntervalRef.current = setInterval(() => {
        const currentTime = Date.now();
        let calculatedProgress;
        let progressForDrawing; // Separate variable for the drawing effect's progress

        // Check if generated image is available to trigger quick finish (only one now)
        if (generatedImageUrlStandard) {
          // If this is the first time we detect generatedImageUrl, record current progress
          if (preFinishProgressRef.current === 0) {
            preFinishProgressRef.current = progress; // Use the current progress
            processStartTimeRef.current = currentTime; // Reset start time for quick finish animation
          }

          const finishElapsed = currentTime - processStartTimeRef.current;
          const finishDuration = 400; // 0.4 seconds for quick finish
          let finishNormalized = Math.min(1, finishElapsed / finishDuration);

          // Apply linear easing for the quick finish
          calculatedProgress = preFinishProgressRef.current + (100 - preFinishProgressRef.current) * finishNormalized;

          if (calculatedProgress >= 100) {
            calculatedProgress = 100;
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
            // ONLY set these when the animation is truly complete
            setGeneratedImageOpacity(1); // Fade in the generated images
            setIsProcessing(false); // End processing here
            if (ctx && canvas) {
              ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas on success
            }
          }
          progressForDrawing = calculatedProgress; // Drawing matches visible progress during final sprint
        } else {
          // Normal processing with deceleration and potential long-wait animation
          const elapsed = currentTime - processStartTimeRef.current; // Use the original start time
          let linearNormalizedProgress = elapsed / nominalDuration;

          if (linearNormalizedProgress < slowDownThreshold) {
            // Linear progression up to the slowdown threshold
            calculatedProgress = linearNormalizedProgress * 100;
          } else {
            // Decelerate smoothly after the slowdown threshold
            // Normalize the progress within the slowdown phase (from 0 to 1)
            const progressInSlowdownPhase = (linearNormalizedProgress - slowDownThreshold) / (1 - slowDownThreshold);
            // Apply the new easing function for deceleration with a minimum speed
            const easedProgressInSlowdownPhase = easeOutQuadWithMinSpeed(progressInSlowdownPhase, minSlowDownFactor);
            
            // Calculate the actual progress for the visible bar
            calculatedProgress = slowDownThreshold * 100 + (100 - slowDownThreshold * 100) * easedProgressInSlowdownPhase;
            // Cap it at the pause percentage for the visible bar
            calculatedProgress = Math.min(calculatedProgress, pauseAtProgress);
          }

          // Logic for drawing effect when waiting for image generation (after visible bar caps)
          if (calculatedProgress >= pauseAtProgress) {
            // If we've hit the visible progress cap, continuously animate the pixelation/scanlines
            const cycleTime = (currentTime - processStartTimeRef.current) % animationCycleDuration;
            const cycleNormalized = cycleTime / animationCycleDuration; // 0 to 1, cycles over animationCycleDuration

            // Use a smooth oscillation (sine wave) to make pixelation and scanlines subtly change
            progressForDrawing = minDrawProgress + ((maxDrawProgress - minDrawProgress) / 2) * (1 + Math.sin(cycleNormalized * 2 * Math.PI));
          } else {
            // Before hitting the cap, drawing progress matches visible progress
            progressForDrawing = calculatedProgress;
          }
        }

        // Ensure visible progress never moves backward
        setProgress(prevProgress => Math.max(prevProgress, calculatedProgress));

        // Continue pixelation animation as long as processing
        const sourceElement = isCameraActive ? videoRef.current : img;
        if (sourceElement && (sourceElement instanceof HTMLImageElement ? sourceElement.complete : sourceElement.readyState >= 2)) {
          drawLoadingEffect(ctx, sourceElement, progressForDrawing); // Use progressForDrawing here
        }
      }, 50); // Update every 50ms for smooth animation

    } else { // When not processing (e.g., finished, error, or cancelled)
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      // Reset all refs when not processing
      processStartTimeRef.current = null;
      randomSlowDownPointRef.current = null;
      preFinishProgressRef.current = 0;

      // Check for generated image to confirm success (only one now)
      if (generatedImageUrlStandard) {
        setProgress(100); // Ensure it's 100% on success
        setGeneratedImageOpacity(1); // Fade in the generated images
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas on success
        }
      } else if (errorMessage) {
        // On error, pause pixelation at its current state (based on last progress)
        setGeneratedImageOpacity(0); // Ensure generated image is hidden
        const sourceElement = isCameraActive ? videoRef.current : img;
        if (ctx && canvas && sourceElement && (sourceElement instanceof HTMLImageElement ? sourceElement.complete : sourceElement.readyState >= 2)) {
            // Redraw the last pixelated frame
            drawLoadingEffect(ctx, sourceElement, progress); // Use the final visible progress for static error state
        }
      } else {
        setProgress(0); // Reset if not processing and no result/error
        setGeneratedImageOpacity(0); // Ensure generated images is hidden
        if (ctx && canvas) { // Only clear if no error and no generated images
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    }

    // Cleanup function: This runs when the component unmounts or dependencies changes
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [isProcessing, generatedImageUrlStandard, errorMessage, isCameraActive]);

  // NEW useEffect for live camera pixelation effect
  useEffect(() => {
    let animationFrameId;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const video = videoRef.current;

    const animatePixelation = () => {
      // Only draw live pixelation if camera is active AND not currently in the main processing phase
      // AND no error message is present (to allow static pixelation on error)
      if (isCameraActive && !isProcessing && !errorMessage && video && video.readyState >= 2 && ctx) {
        // Use a fixed low progress value (e.g., 10%) for a subtle, consistent effect
        drawLoadingEffect(ctx, video, 10);
      }
      animationFrameId = requestAnimationFrame(animatePixelation);
    };

    if (isCameraActive) {
      console.log('Starting live camera pixelation effect.');
      animationFrameId = requestAnimationFrame(animatePixelation);
    } else {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      // Only clear canvas when camera is no longer active AND not processing AND no error
      if (ctx && canvas && !isProcessing && !errorMessage) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      console.log('Stopping live pixelation effect.');
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      // Ensure canvas is cleared if component unmounts or camera is turned off, AND not processing AND no error
      if (ctx && canvas && !isProcessing && !errorMessage) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [isCameraActive, isProcessing, errorMessage]);


  // --- CAMERA FUNCTIONS ---
  // Function to stop only the tracks of the current camera stream
  const stopCurrentStreamTracks = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null); // Clear the stream object
      console.log('Current camera stream tracks stopped.');
    }
  };

  // Function to start the camera with a specific facing mode
  const startCamera = async (mode) => {
    console.log(`startCamera called with mode: ${mode}.`);
    // Ensure any existing stream is stopped before requesting a new one
    stopCurrentStreamTracks(); // This will clear cameraStream state

    // Reset states relevant to starting a new camera session
    setGeneratedImageUrlStandard(null);
    setGeneratedImageOpacity(0);
    setOriginalImageDataUrl(null);
    setLastProcessedImageDataUrl(null); // Clear last processed image on new camera session
    setIsProcessing(false);
    setErrorMessage('');
    setProgress(0);
    setShowSideBySide(false);
    setIsCaptureReady(false); // Ensure capture is not ready until new stream loads
    setDescriptionText(''); // Clear description when starting camera
    console.log('States reset for new camera session.');

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported by your browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      setCameraStream(stream);
      setIsCameraActive(true); // Camera is now active
      setErrorMessage(''); // Clear any previous errors
      console.log(`Camera stream successfully started with facingMode: ${mode}.`);
    } catch (error) {
      console.error('Error starting camera:', error);
      setErrorMessage(`Failed to open camera: ${error.message}. Please ensure camera access is granted.`);
      // If there's an error, ensure camera is fully deactivated
      setCameraStream(null);
      setIsCameraActive(false);
      setIsCaptureReady(false);
    }
  };

  // Modified handleOpenCamera to just initiate the first camera
  const handleOpenCamera = () => {
    setFacingMode('environment'); // Always start with rear camera
    startCamera('environment');
  };

  // Modified stopCamera to fully deactivate
  const stopCamera = () => {
    stopCurrentStreamTracks(); // Stop tracks and clear stream state
    setIsCameraActive(false); // Fully deactivate camera
    setIsCaptureReady(false);
    console.log('Camera fully deactivated.');
  };

  // Modified switchCamera
  const switchCamera = () => {
    console.log('Attempting to switch camera...');
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode); // Update state
    startCamera(nextMode); // Immediately try to start camera with new mode
  };


  // useEffect to handle video stream assignment and readiness
  useEffect(() => {
    const videoElement = videoRef.current;
    if (videoElement && cameraStream) {
      console.log('Attaching stream to video element and setting up oncanplay listener.');
      videoElement.srcObject = cameraStream;

      const handleCanPlay = async () => {
        console.log('Video oncanplay event fired. Video dimensions:', videoElement.videoWidth, videoElement.videoHeight);
        try {
          await videoElement.play();
          setIsCaptureReady(true); // Enable capture button
          console.log('Video playback started and capture is ready.');
        } catch (e) {
          console.error("Error playing video or setting capture ready:", e);
          setErrorMessage(`Error playing video: ${e.message}. You might need to tap the video to start playback.`);
          setIsCaptureReady(false); // Keep disabled if play fails
        }
      };

      videoElement.addEventListener('canplay', handleCanPlay);

      // Clean up the event listener if component unmounts or dependencies changes
      return () => {
        console.log('Cleaning up video event listener.');
        videoElement.removeEventListener('canplay', handleCanPlay);
      };
    } else if (videoElement && !cameraStream) {
      // If video element exists but no stream, ensure it's stopped and capture is not ready
      videoElement.srcObject = null;
      setIsCaptureReady(false);
    }
  }, [videoRef, cameraStream]); // Dependencies: videoRef (for current value), cameraStream


  const handleCapturePhoto = async () => {
    console.log('handleCapturePhoto called.');
    if (!videoRef.current || !isCameraActive || !isCaptureReady) {
      setErrorMessage('Camera not active or ready for capture.');
      return;
    }

    const video = videoRef.current;
    const originalVideoWidth = video.videoWidth;
    const originalVideoHeight = video.videoHeight;

    if (originalVideoWidth === 0 || originalVideoHeight === 0) {
      setErrorMessage('Video stream dimensions are 0. Cannot capture. Try again.');
      return;
    }

    // Define target output dimensions for 7:10 aspect ratio
    const desiredOutputWidth = 1024;
    const desiredOutputHeight = Math.round((1 / TARGET_ASPECT_RATIO) * desiredOutputWidth); // 1024 * (10/7) = 1462.85 -> 1463

    // Create a temporary canvas to draw the video frame at the desired output resolution (7:10)
    const captureCanvas = document.createElement('canvas');
    const captureCtx = captureCanvas.getContext('2d');

    captureCanvas.width = desiredOutputWidth;
    captureCanvas.height = desiredOutputHeight;

    // Calculate source rectangle to crop the center 7:10 from the video feed
    let sx, sy, sWidth, sHeight;

    const videoAspectRatio = originalVideoWidth / originalVideoHeight;

    if (videoAspectRatio > TARGET_ASPECT_RATIO) { // Video is wider than 7:10
      sHeight = originalVideoHeight;
      sWidth = originalVideoHeight * TARGET_ASPECT_RATIO;
      sx = (originalVideoWidth - sWidth) / 2;
      sy = 0;
    } else { // Video is taller or 7:10
      sWidth = originalVideoWidth;
      sHeight = originalVideoWidth / TARGET_ASPECT_RATIO;
      sx = 0;
      sy = (originalVideoHeight - sHeight) / 2;
    }

    // Draw the cropped section of the video onto the capture canvas, scaling it to 7:10
    captureCtx.drawImage(
      video,
      sx,         // sx: x-coordinate of the top-left corner of the source rectangle
      sy,         // sy: y-coordinate of the top-left corner of the source rectangle
      sWidth,     // sWidth: width of the source rectangle
      sHeight,    // sHeight: height of the source rectangle
      0,          // dx: x-coordinate of the top-left corner of the destination rectangle
      0,          // dy: y-coordinate of the top-left corner of the destination rectangle
      desiredOutputWidth, // dWidth: width of the destination rectangle
      desiredOutputHeight  // dHeight: height of the destination rectangle
    );

    const croppedDataUrl = captureCanvas.toDataURL('image/png');
    console.log(`Captured video frame, cropped and scaled to 7:10: ${desiredOutputWidth}x${desiredOutputHeight}`);

    // Set the original image data URL for display/comparison
    setOriginalImageDataUrl(croppedDataUrl);

    // Set the originalImageRef for canvas drawing during loading
    originalImageRef.current = new Image();
    originalImageRef.current.src = croppedDataUrl;
    originalImageRef.current.onload = () => {
        console.log('Captured image loaded for loading effect.');
    };
    originalImageRef.current.onerror = (e) => {
        console.error('Error loading captured image into ref:', e);
    };

    // Stop the camera as the image is captured
    stopCamera();

    // Proceed with the image generation process
    handleGenerateImageProcess(croppedDataUrl);
  };
  // --- END CAMERA FUNCTIONS ---


  // Function to handle file selection (existing logic)
  const handleFileChange = (event) => {
    console.log('handleFileChange called.');
    const file = event.target.files[0];
    console.log('Selected file:', file ? file.name : 'No file');

    // Reset all states when a new file is selected
    setGeneratedImageUrlStandard(null);
    setGeneratedImageOpacity(0); // Ensure opacity is reset
    setOriginalImageDataUrl(null); // Clear previous original image data URL
    setLastProcessedImageDataUrl(null); // Clear last processed image on new file selection
    setIsProcessing(false); // Temporarily false, will be set true in handleGenerateImageProcess
    setErrorMessage('');
    setProgress(0);
    setShowSideBySide(false); // Hide side-by-side view
    stopCamera(); // Ensure camera is stopped if user switches to file input
    setDescriptionText(''); // Clear description when new file is selected
    console.log('States reset for new file selection.');

    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        console.log('FileReader onloadend triggered.');
        const originalLoadedImage = new Image();
        originalLoadedImage.onload = () => {
          console.log('Original image loaded into Image object for cropping.');
          const originalWidth = originalLoadedImage.width;
          const originalHeight = originalLoadedImage.height;

          // Define target output dimensions for 7:10 aspect ratio
          const desiredOutputWidth = 1024;
          const desiredOutputHeight = Math.round((1 / TARGET_ASPECT_RATIO) * desiredOutputWidth); // 1024 * (10/7) = 1462.85 -> 1463

          // Create a temporary canvas for cropping to 7:10
          const croppedCanvas = document.createElement('canvas');
          const croppedCtx = croppedCanvas.getContext('2d');

          croppedCanvas.width = desiredOutputWidth;
          croppedCanvas.height = desiredOutputHeight;

          // Calculate source rectangle to crop the center 7:10 from the original image
          let sx, sy, sWidth, sHeight;

          const imageAspectRatio = originalWidth / originalHeight;

          if (imageAspectRatio > TARGET_ASPECT_RATIO) { // Image is wider than 7:10
              sHeight = originalHeight;
              sWidth = originalHeight * TARGET_ASPECT_RATIO;
              sx = (originalWidth - sWidth) / 2;
              sy = 0;
          } else { // Image is taller or 7:10
              sWidth = originalWidth;
              sHeight = originalWidth / TARGET_ASPECT_RATIO;
              sx = 0;
              sy = (originalHeight - sHeight) / 2;
          }

          // Draw the cropped section of the original image onto the new canvas, scaling it to 7:10
          croppedCtx.drawImage(
              originalLoadedImage,
              sx,         // sx
              sy,         // sy
              sWidth,     // sWidth
              sHeight,    // sHeight
              0,          // dx
              0,          // dy
              desiredOutputWidth, // dWidth
              desiredOutputHeight  // dHeight
          );

          const croppedDataUrl = croppedCanvas.toDataURL('image/png');
          console.log(`Original image cropped and scaled to 7:10 dimensions: ${desiredOutputWidth}x${desiredOutputHeight}`);

          // Store the cropped image data URL for side-by-side comparison
          setOriginalImageDataUrl(croppedDataUrl);

          // Set the originalImageRef for canvas drawing during loading
          originalImageRef.current = new Image();
          originalImageRef.current.src = croppedDataUrl;
          originalImageRef.current.onload = () => {
            console.log('File-selected image loaded for loading effect.');
          };
          originalImageRef.current.onerror = (e) => {
            console.error('Error loading file-selected image into ref:', e);
          };

          console.log('Calling handleGenerateImageProcess directly after cropping and setting originalImageRef.');
          handleGenerateImageProcess(croppedDataUrl); // Trigger the API calls and processing
        };
        originalLoadedImage.src = reader.result;
        console.log('FileReader reading file as DataURL for original image loading.');
      };
      reader.readAsDataURL(file);
    }
  };

  // Cleanup effect to stop camera when component unmounts
  useEffect(() => {
    return () => {
      stopCamera();
      // Ensure any ongoing fetch is aborted if component unmounts
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []); // Run only once on mount and unmount

  // New function to toggle debug mode
  const handleToggleDebugMode = () => {
    setIsDebugMode(prevMode => !prevMode);
  };


  return (
    <div className="min-h-dvh flex flex-col items-center font-sans bg-white pt-8">
      {/* Outer container for the entire app, now conditionally adjusts max-width and padding */}
      <div className={`w-full mx-auto text-center flex-grow
        ${showSideBySide ? 'px-2' : 'max-w-lg px-4'}
      `}>
        {/* Header with Logo */}
        <div className="flex items-center justify-center mb-6">
          <img
            src="https://brianweinstein.github.io/rpc-dev/favicon.png"
            alt="App Logo"
            className="w-8 h-8 mr-2 object-contain"
          />
          <h1 className="text-xl font-normal text-gray-900">Camera 3000</h1>
        </div>

        {/* Unified Image Display Area */}
        <div className={`mt-6 relative flex flex-col justify-center items-center overflow-hidden mx-auto rounded-md  border-gray-000
          w-[298px] h-[426px] bg-gray-000 {/* Fixed dimensions for 7:10 ratio */}
        `}
        style={showSideBySide ? { width: 'min(95vw, 550px)', height: '426px' } : {}}
        >
          {showSideBySide ? (
            // Side-by-Side Comparison View for 2 images (Original and Standard Generated)
            <div className="flex flex-row gap-1.5 justify-center items-center w-full h-full"> {/* Changed h-auto to h-full */}
              {originalImageDataUrl && (
                <div className="flex flex-col justify-center items-center h-full w-1/2 p-0">
                  <img
                    src={originalImageDataUrl}
                    className="max-w-full max-h-full object-contain rounded-md border border-gray-200"
                    alt="Boring old camera photo"
                  />
                  <p className="text-xs mt-1 text-gray-600">Boring old camera</p>
                </div>
              )}
              {generatedImageUrlStandard && (
                <div className="flex flex-col justify-center items-center h-full w-1/2 p-0">
                  <img
                    src={generatedImageUrlStandard}
                    className="max-w-full max-h-full object-contain rounded-md border border-gray-200"
                    alt="Camera 3000 photo"
                  />
                  <p className="text-xs mt-1 text-gray-600">Camera 3000</p>
                </div>
              )}
            </div>
          ) : (
            // Single Image Display View (Standard Quality by default)
            <>
              {isCameraActive && (
                <>
                  <video
                    ref={videoRef}
                    className="rounded-md w-full h-full object-contain relative z-0"
                    playsInline
                    autoPlay
                    muted
                  ></video>
                  {/* Canvas for live pixelation effect on top of video */}
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full rounded-md object-cover pointer-events-none z-10"
                  ></canvas>
                </>
              )}

              {/* Gray placeholder box */}
              {!isCameraActive && !isProcessing && !generatedImageUrlStandard && !originalImageDataUrl && (
                <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 rounded-md">
                  {/* <p>Upload or take a photo</p> */}
                </div>
              )}

              {/* Canvas for processing pixelation effect (when not camera active) */}
              {isProcessing && !isCameraActive && (
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full rounded-md object-contain mx-auto"></canvas>
              )}

              {/* Display generated image with fade-in transition (no pixelation) */}
              {!isCameraActive && !isProcessing && generatedImageUrlStandard && (
                <img
                  src={generatedImageUrlStandard}
                  alt="Generated by AI"
                  className="absolute inset-0 w-full h-full rounded-md object-contain mx-auto transition-opacity duration-2500 ease-in-out"
                  style={{ opacity: generatedImageOpacity }}
                />
              )}
              {/* Display original image when not camera active, not processing, and no generated image */}
              {!isCameraActive && !isProcessing && !generatedImageUrlStandard && originalImageDataUrl && (
                <img
                    src={originalImageDataUrl}
                    className="w-full h-full object-contain mx-auto rounded-md"
                    alt="Boring old camera photo"
                />
              )}
            </>
          )}
        </div>

        )}

        {/* Camera Action Buttons (Capture/Cancel/Switch) - directly below the photo/retry button */}
        {isCameraActive && (
          <div className="mt-4 relative flex flex-col items-center justify-center w-full space-y-4">
            {/* Container for Capture and Switch buttons, directly below the video feed */}
            <div className="relative w-full flex items-center justify-center" style={{ height: '96px' }}>
              {/* Capture Photo Button (iOS style) - Centered horizontally */}
              <button
                onClick={handleCapturePhoto}
                disabled={!isCaptureReady}
                className={`w-16 h-16 rounded-full flex-shrink-0 flex items-center justify-center transition duration-200 ease-in-out absolute left-1/2 -translate-x-1/2
                           ${isCaptureReady ? 'border-4 border-black bg-white shadow-md hover:bg-gray-100' : 'border-4 border-gray-400 bg-gray-200 cursor-not-allowed'}`}
                style={{ bottom: '16px' }}
              >
                <div className={`w-12 h-12 rounded-full transition duration-200 ${isCaptureReady ? 'bg-black' : 'bg-gray-400'}`}></div> {/* Inner black circle */}
              </button>

              {/* Switch Camera Button (iOS style) - Smaller, aligned right */}
              <button
                onClick={switchCamera}
                className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center transition duration-200 ease-in-out border-2 border-white text-white bg-transparent hover:bg-white hover:text-blue-500 shadow-md absolute"
                // Adjusted left position to be 20px right of the capture button's right edge
                style={{ bottom: '28px', left: 'calc(50% + (64px / 2) + 20px)' }}
              >
                {/* Reload / Two Arrows Circle SVG Icon (black) */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="100%" height="100%" // Use percentages to scale within button size
                  version="1.1" viewBox="0 0 100 100"
                  fill="black" // Set fill to black for the icon
                >
                  <path d="m81 59.898c-1.8984-0.89844-4.1016 0-5 1.8984-6.5 14.402-23.5 20.703-37.801 14.203-6.8008-3.1016-12-8.6016-14.801-15.5l4.8008 2.1992c1.8984 0.89844 4.1016 0 5-1.8984 0.89844-1.8984 0-4.1016-1.8984-5l-12.801-5.8008c-1.8984-0.89844-4.1016 0-5 1.8984l-5.6992 12.801c-0.89844 1.8984 0 4.1016 1.8984 5 1.8984 0.89844 4.1016 0 5-1.8984l1.8984-4.1992c3.5 8.6016 10 15.398 18.5 19.301 18.102 8.1992 39.602 0.19922 47.801-18 0.80078-1.9023 0-4.1016-1.8984-5.0039z"/>
                  <path d="m24 38.199c6.5-14.398 23.5-20.699 37.801-14.199 6.8008 3.1016 12 8.6016 14.801 15.5l-4.8008-2.1992c-1.8984-0.89844-4.1016 0-5 1.8984-0.89844 1.8984 0 4.1016 1.8984 5l12.801 5.8008c1.8984 0.89844 4.1016 0 5-1.8984l5.8008-12.801c0.89844-1.8984 0-4.1016-1.8984-5-1.8984-0.89844-4.1016 0-5 1.8984l-1.8984 4.1992c-3.5-8.6016-10-15.398-18.5-19.301-18.102-8.1992-39.602-0.19922-47.801 18-0.89844 1.8984 0 4.1016 1.8984 5 1.7969 0.80078 4 0.003906 4.8984-1.8984z"/>
                </svg>
              </button>
            </div>

            {/* Cancel Camera Button (on its own line) */}
            <button
              onClick={stopCamera}
                className="mt-4 py-2 px-4 rounded-md font-normal transition duration-200 ease-in-out shadow-sm hover:shadow-md bg-gray-300 text-gray-800 hover:bg-gray-400"
            >
              Close Camera
            </button>
          </div>
        )}

        {/* Action Buttons: Compare/Back Button - appears only after images are generated AND processing is complete */}
        {!isProcessing && generatedImageUrlStandard && !errorMessage && (
          <div className="mt-6 flex flex-col space-y-3 items-center">
            <button
              onClick={() => setShowSideBySide(!showSideBySide)}
              className="py-2 px-4 text-sm rounded-md font-normal transition duration-200 ease-in-out shadow-sm hover:shadow-md w-fit mx-auto"
            >
              {showSideBySide ? 'Back' : 'Compare'}
            </button>
          </div>
        )}

        {/* Container for initial buttons (Open Camera/Upload) and Progress Bar */}
        <div className="mt-auto pt-6 flex flex-col justify-center items-center">
          {/* Combined Open Camera / Upload Photo Button */}
          {!isCameraActive && !isProcessing && (
            <div className="flex rounded-lg shadow-lg overflow-hidden w-60 max-w-64">
              {/* Left 75% for Camera */}
              <button
                onClick={handleOpenCamera}
                className="flex-grow w-3/4 py-3 px-2 bg-blue-600 text-white hover:bg-blue-600 transition duration-200 ease-in-out inline-flex items-center justify-center rounded-l-lg"
              >
                {/* Corrected Camera SVG */}
                <svg
                  className="w-5 h-5 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                  ></path>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                  ></path>
                </svg>
                Open Camera
              </button>
              {/* Right 25% for Upload (Dropdown Icon) */}
              <label
                htmlFor="select-photo"
                className="w-1/4 py-3 px-2 bg-blue-600 text-white hover:bg-blue-600 transition duration-200 ease-in-out inline-flex items-center justify-center rounded-r-lg border-l-2 border-white cursor-pointer"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 9l-7 7-7-7"
                  ></path>
                </svg>
              </label>
              <input
                id="select-photo"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          )}

          {/* Progress bar overlay - always visible when processing */}
          {isProcessing && (
            <div className="mt-4 text-center">
              <div className="w-[298px] bg-gray-200 rounded-md h-2.5 mx-auto">
                <div
                  className="bg-blue-500 h-2.5 rounded-md transition-all duration-50 ease-linear"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              {/* "Cancel Photo" button */}
              <button
                onClick={handleCancelProcess}
                className="mt-4 py-2 px-4 rounded-md font-normal transition duration-200 ease-in-out shadow-sm hover:shadow-md bg-gray-300 text-gray-800 hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          )}
        </div> {/* End of bottom buttons/progress container */}

        {/* Error message display */}
        {errorMessage && (
          <div className="mt-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded-md text-center max-w-lg mx-auto">
            {isDebugMode ? (
              <p>{errorMessage}</p>
            ) : (
              <p>Error taking photo.</p>
            )}
          </div>
        )}

        {/* Description text display at the very bottom, only visible in debug mode */}
        {isDebugMode && descriptionText && (
          <div className="mt-8 p-4 bg-gray-50 border border-gray-200 text-gray-700 rounded-md text-left text-sm leading-relaxed max-w-lg mx-auto">
            {/* <p className="font-semibold mb-2">Description:</p> */}
            <p className="whitespace-pre-wrap">{descriptionText}</p>
          </div>
        )}
      </div>
      {/* Small text at the very bottom */}
      <div className="mt-8 mb-2 text-xs text-gray-400 text-center flex items-center justify-center space-x-2">
        <p><a href="https://github.com/BrianWeinstein/rpc-dev" target="_blank" className="hover:underline">About</a></p>
        <p>•</p> {/* Separator */}
        {/* Debug Mode Toggle Switch */}
        <div className="flex items-center space-x-1">
          <span className="text-gray-400">Debug Mode</span>
          <button
            onClick={handleToggleDebugMode}
            className={`relative inline-flex h-4 w-9 items-center rounded-full transition-colors duration-200 ease-in-out 
              ${isDebugMode ? 'bg-blue-500' : 'bg-gray-200'}
            `}
          >
            <span
              className={`inline-block h-2 w-2 transform rounded-full transition-transform duration-200 ease-in-out
                ${isDebugMode ? 'translate-x-6 bg-gray-200' : 'translate-x-1 bg-white'}
              `}
            ></span>
            <span
              className={`absolute right-1 text-[9.5px]  font-bold font-sans transition-opacity duration-200 ease-in-out
                ${isDebugMode ? 'text-white opacity-0' : 'text-gray-400 opacity-100'}
              `}
              style={{ top: '50%', transform: 'translateY(-50%)' }}
            >
              Off
            </span>
            <span
              className={`absolute left-1.5 text-[9.5px]  font-bold font-sans transition-opacity duration-200 ease-in-out
                ${isDebugMode ? 'text-gray-200 opacity-100' : 'text-gray-400 opacity-0'}
              `}
              style={{ top: '50%', transform: 'translateY(-50%)' }}
            >
              On
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
