const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 480;

const videoEl = document.getElementById("cameraVideo");
const canvasEl = document.getElementById("captureCanvas");
const statusEl = document.getElementById("statusText");
const buttonEl = document.getElementById("markAttendanceBtn");
const loadingOverlayEl = document.getElementById("loadingOverlay");

const tg = window.Telegram?.WebApp;
const queryApiBase = new URLSearchParams(window.location.search).get("api_base");
const apiBase = normalizeApiBase(queryApiBase || window.API_BASE_URL || "http://127.0.0.1:8000");

let stream;

initTelegramWebApp();
initCamera().catch((err) => {
  setStatus(`Unable to access camera: ${err.message || err}`, "error");
});

buttonEl.addEventListener("click", onMarkAttendance);

function initTelegramWebApp() {
  if (!tg) {
    setStatus("Telegram WebApp SDK not detected. Open this from Telegram.", "error");
    return;
  }

  tg.ready();
  tg.expand();
}

async function initCamera() {
  setProcessing(true, "Opening front camera...");

  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: CAPTURE_WIDTH },
      height: { ideal: CAPTURE_HEIGHT },
    },
    audio: false,
  });

  videoEl.srcObject = stream;
  await videoEl.play();

  buttonEl.disabled = false;
  setProcessing(false);
  setStatus("Face aligned? Tap Mark Attendance.");
}

async function onMarkAttendance() {
  if (buttonEl.disabled) {
    return;
  }

  setProcessing(true, "Capturing and verifying...");

  try {
    const location = await getCurrentLocation();
    const frameBlob = await captureFrameAsBlob(videoEl, canvasEl);
    const response = await postAttendanceFrame(frameBlob, location);

    if (tg) {
      tg.sendData(JSON.stringify({
        type: "attendance_result",
        verified: !!response.verified,
        attendance_marked: !!response.attendance_marked,
        message: response.message || "",
      }));
    }

    if (response.verified) {
      setStatus(response.message || "Attendance verified.", "success");
      if (tg) {
        tg.HapticFeedback?.notificationOccurred("success");
      }
    } else {
      setStatus(response.message || "Face verification failed.", "error");
      if (tg) {
        tg.HapticFeedback?.notificationOccurred("error");
      }
    }
  } catch (err) {
    setStatus(err.message || "Verification failed", "error");
  } finally {
    setProcessing(false);
  }
}

async function captureFrameAsBlob(video, canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;

  // Mirror preview for UX but capture normalized orientation for backend.
  ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not capture image."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.9,
    );
  });
}

async function postAttendanceFrame(frameBlob, location) {
  const form = new FormData();
  form.append("image", frameBlob, "capture.jpg");
  form.append("lat", String(location.lat));
  form.append("lon", String(location.lon));

  const telegramId = tg?.initDataUnsafe?.user?.id;
  if (telegramId) {
    form.append("telegram_id", String(telegramId));
  }

  const response = await fetch(`${apiBase}/verify-attendance`, {
    method: "POST",
    body: form,
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Server returned invalid response.");
  }

  if (!response.ok) {
    throw new Error(payload.detail || "Attendance verification request failed.");
  }

  return payload;
}

function normalizeApiBase(value) {
  return String(value || "").replace(/\/$/, "");
}

async function getCurrentLocation() {
  if (!navigator.geolocation) {
    throw new Error("Location is not supported on this device.");
  }

  setStatus("Getting live location permission...");

  return await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      () => {
        reject(new Error("Location is required. Please allow location and try again."));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  });
}

function setProcessing(isProcessing, message = "") {
  buttonEl.disabled = isProcessing;
  loadingOverlayEl.classList.toggle("hidden", !isProcessing);
  if (isProcessing && message) {
    setStatus(message);
  }
}

function setStatus(message, tone = "") {
  statusEl.textContent = message;
  statusEl.classList.remove("error", "success");
  if (tone) {
    statusEl.classList.add(tone);
  }
}

window.addEventListener("beforeunload", () => {
  if (!stream) {
    return;
  }
  stream.getTracks().forEach((track) => track.stop());
});
