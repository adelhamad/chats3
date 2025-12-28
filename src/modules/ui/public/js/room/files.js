/* eslint-disable no-undef */
// File handling

import { $, apiFetch, setSelectedFile } from "./state.js";

export function handleFileSelect(event) {
  const file = event.target.files ? event.target.files[0] : null;
  if (!file) {
    return;
  }

  setSelectedFile(file);
  if ($.fileInput) {
    $.fileInput.value = "";
  }

  $.previewContainer.innerHTML = "";
  $.previewContainer.style.display = "flex";

  const previewItem = document.createElement("div");
  previewItem.className = "preview-item";

  if (file.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.onerror = () => {
      img.style.display = "none";
      const errorText = document.createElement("div");
      errorText.textContent = "Image Error";
      errorText.style.cssText = "font-size:10px;color:red";
      previewItem.appendChild(errorText);
    };
    previewItem.appendChild(img);
  } else {
    const div = document.createElement("div");
    div.textContent = "File: " + file.name;
    div.style.cssText =
      "padding:10px;font-size:12px;display:flex;align-items:center;justify-content:center;height:100%";
    previewItem.appendChild(div);
  }

  const removeBtn = document.createElement("div");
  removeBtn.className = "preview-remove";
  removeBtn.textContent = "✕";
  removeBtn.onclick = () => {
    setSelectedFile(null);
    $.previewContainer.innerHTML = "";
    $.previewContainer.style.display = "none";
  };

  previewItem.appendChild(removeBtn);
  $.previewContainer.appendChild(previewItem);
}

export function handlePaste(event) {
  const items = (event.clipboardData || event.originalEvent.clipboardData)
    .items;
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      handleFileSelect({ target: { files: [file] } });
      event.preventDefault();
      return;
    }
  }
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch("/api/v1/attachments", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || "Upload failed");
  }
  return data.details;
}
