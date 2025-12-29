/* eslint-disable no-undef */
// Room state and DOM elements

// URL params
const urlParams = new URLSearchParams(window.location.search);
export const sessionId = urlParams.get("sessionId");

// Configurable reactions (add/remove emojis here)
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

// State
export let sessionInfo = null;
export const peerConnections = new Map(); // userId -> RTCPeerConnection
export const dataChannels = new Map(); // userId -> RTCDataChannel
export const messageReactions = new Map(); // messageId -> Map<emoji, Set<userId>>
export let localStream = null;
export let screenStream = null;
export let isScreenSharing = false;
export let selectedFile = null;
export const lastSeenMap = new Map(); // userId -> timestamp

// Setters for mutable state
export function setSessionInfo(info) {
  sessionInfo = info;
}
export function setLocalStream(stream) {
  localStream = stream;
}
export function setScreenStream(stream) {
  screenStream = stream;
}
export function setIsScreenSharing(value) {
  isScreenSharing = value;
}
export function setSelectedFile(file) {
  selectedFile = file;
}

// DOM Elements
export const $ = {
  messagesDiv: document.getElementById("chatMessages"),
  messageInput: document.getElementById("messageInput"),
  sendButton: document.getElementById("sendButton"),
  attachButton: document.getElementById("attachButton"),
  callButton: document.getElementById("callButton"),
  audioBtn: document.getElementById("audioBtn"),
  videoBtn: document.getElementById("videoBtn"),
  screenBtn: document.getElementById("screenBtn"),
  endCallButton: document.getElementById("endCallButton"),
  recordButton: document.getElementById("recordButton"),
  stopRecordButton: document.getElementById("stopRecordButton"),
  callControls: document.getElementById("callControls"),
  videoContainer: document.getElementById("videoContainer"),
  localVideo: document.getElementById("localVideo"),
  remoteVideosDiv: document.getElementById("remoteVideos"),
  fileInput: document.getElementById("fileInput"),
  statusSpan: document.getElementById("connectionStatus"),
  userNameSpan: document.getElementById("userName"),
  previewContainer: document.getElementById("previewContainer"),
  leaveButton: document.getElementById("leaveButton"),
  searchToggle: document.getElementById("searchToggle"),
  searchBar: document.getElementById("searchBar"),
  searchInput: document.getElementById("searchInput"),
  searchClose: document.getElementById("searchClose"),
  searchUp: document.getElementById("searchUp"),
  searchDown: document.getElementById("searchDown"),
  searchCount: document.getElementById("searchCount"),
};

// API Fetch helper with session isolation
export async function apiFetch(url, options = {}) {
  if (sessionId) {
    options.headers = { ...options.headers, "x-session-id": sessionId };
  }
  return fetch(url, options);
}

// Utility - use native crypto.randomUUID
export function generateUUID() {
  return crypto.randomUUID();
}

export function scrollToBottom() {
  $.messagesDiv.scrollTop = $.messagesDiv.scrollHeight;
}
