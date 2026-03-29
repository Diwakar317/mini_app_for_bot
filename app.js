const video = document.getElementById("cameraVideo");
const canvas = document.getElementById("captureCanvas");
const markBtn = document.getElementById("markBtn");
const statusText = document.getElementById("statusText");
const loadingOverlay = document.getElementById("loadingOverlay");

const tg = window.Telegram?.WebApp;
const params = new URLSearchParams(window.location.search);
const apiBase = (params.get("api_base") || "http://127.0.0.1:8000").replace(/\/$/, "");
const captureToken = params.get("capture_token") || "";

let stream = null;
let isBusy = false;

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", Boolean(isError));
}

function setBusy(busy) {
  isBusy = busy;
  markBtn.disabled = busy;
  loadingOverlay.classList.toggle("hidden", !busy);
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
    video.srcObject = stream;
    await video.play();
    setStatus("Camera ready. Align face and tap Mark Attendance.");
  } catch (error) {
    console.error(error);
    setStatus("Camera access denied or unavailable. Allow camera and retry.", true);
    markBtn.disabled = true;
  }
}

function captureFrameBlob() {
  return new Promise((resolve, reject) => {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      reject(new Error("Canvas context unavailable"));
      return;
    }

    const targetWidth = 640;
    const targetHeight = 480;
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to capture image blob"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.92,
    );
  });
}

async function submitAttendance(blob) {
  const formData = new FormData();
  formData.append("image", blob, "capture.jpg");
  formData.append("init_data", tg?.initData || "");
  formData.append("capture_token", captureToken);

  const response = await fetch(`${apiBase}/verify-attendance`, {
    method: "POST",
    body: formData,
  });

  const payload = await response.json().catch(() => ({ detail: "Unknown server response" }));
  if (!response.ok) {
    const detail = payload?.detail || "Attendance verification failed";
    throw new Error(detail);
  }

  return payload;
}

async function onMarkAttendance() {
  if (isBusy) {
    return;
  }

  if (!captureToken) {
    setStatus("Missing secure capture token. Restart /checkin.", true);
    return;
  }

  if (!tg?.initData) {
    setStatus("Open this screen from Telegram bot only.", true);
    return;
  }

  try {
    setBusy(true);
    setStatus("Capturing frame...");
    const blob = await captureFrameBlob();

    setStatus("Verifying face and marking attendance...");
    const result = await submitAttendance(blob);

    setStatus(result.message || "Done.");
    tg.sendData(
      JSON.stringify({
        type: "attendance_result",
        verified: Boolean(result.verified),
        attendance_marked: Boolean(result.attendance_marked),
        message: String(result.message || ""),
      }),
    );

    tg.MainButton.setText("Done");
    tg.MainButton.show();
    setTimeout(() => tg.close(), 1200);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to mark attendance right now.", true);
  } finally {
    setBusy(false);
  }
}

function initTelegramWebApp() {
  if (!tg) {
    setStatus("Telegram WebApp SDK not found. Open from Telegram.", true);
    markBtn.disabled = true;
    return;
  }

  tg.ready();
  tg.expand();
}

markBtn.addEventListener("click", onMarkAttendance);
window.addEventListener("beforeunload", () => {
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
});

initTelegramWebApp();
startCamera();
