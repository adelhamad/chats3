/* eslint-disable no-undef */
// Recording functionality

import { $ } from "./state.js";

let mediaRecorder;
let recordedChunks = [];

export async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { mediaSource: "screen" },
      audio: true,
    });

    mediaRecorder = new MediaRecorder(stream);
    recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `recording-${new Date().toISOString()}.webm`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 100);

      $.recordButton.style.display = "inline-block";
      $.stopRecordButton.style.display = "none";
    };

    mediaRecorder.start();
    $.recordButton.style.display = "none";
    $.stopRecordButton.style.display = "inline-block";

    stream.getVideoTracks()[0].onended = () => stopRecording();
  } catch (err) {
    console.error("Error starting recording:", err);
    alert("Could not start recording: " + err.message);
  }
}

export function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }
}
