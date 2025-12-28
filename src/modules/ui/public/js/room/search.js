/* eslint-disable no-undef */
// Search functionality

import { $ } from "./state.js";

let currentMatchIndex = -1;
let totalMatches = 0;
let matchElements = [];

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resetSearchState() {
  currentMatchIndex = -1;
  totalMatches = 0;
  matchElements = [];
  updateSearchUI();
}

function updateSearchUI() {
  if (totalMatches === 0) {
    $.searchCount.textContent = "";
    $.searchUp.disabled = true;
    $.searchDown.disabled = true;
  } else {
    $.searchCount.textContent = `${currentMatchIndex + 1} of ${totalMatches}`;
    $.searchUp.disabled = false;
    $.searchDown.disabled = false;
  }
}

function clearHighlights() {
  const highlights = document.querySelectorAll(".highlight");
  highlights.forEach((el) => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });
}

function scrollToMatch(index) {
  matchElements.forEach((el) => el.classList.remove("current"));
  const el = matchElements[index];
  if (el) {
    el.classList.add("current");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  updateSearchUI();
}

function highlightMatches(term) {
  const messageBodies = document.querySelectorAll(".message-body");

  messageBodies.forEach((body) => {
    const walker = document.createTreeWalker(
      body,
      NodeFilter.SHOW_TEXT,
      null,
      false,
    );
    let node;
    const nodesToReplace = [];

    while ((node = walker.nextNode())) {
      if (node.textContent.toLowerCase().includes(term)) {
        nodesToReplace.push(node);
      }
    }

    nodesToReplace.forEach((node) => {
      const text = node.textContent;
      const regex = new RegExp(`(${escapeRegExp(term)})`, "gi");
      const span = document.createElement("span");
      span.innerHTML = text.replace(regex, '<span class="highlight">$1</span>');

      const parent = node.parentNode;
      while (span.firstChild) {
        const child = span.firstChild;
        if (child.classList?.contains("highlight")) {
          matchElements.push(child);
        }
        parent.insertBefore(child, node);
      }
      parent.removeChild(node);
    });
  });

  totalMatches = matchElements.length;
  if (totalMatches > 0) {
    currentMatchIndex = totalMatches - 1;
    scrollToMatch(currentMatchIndex);
  }
  updateSearchUI();
}

export function initSearch() {
  if (!$.searchToggle) {
    return;
  }

  $.searchToggle.onclick = () => {
    $.searchBar.style.display = "flex";
    $.searchInput.focus();
  };

  $.searchClose.onclick = () => {
    $.searchBar.style.display = "none";
    $.searchInput.value = "";
    clearHighlights();
    resetSearchState();
  };

  $.searchUp.onclick = () => {
    if (totalMatches > 0) {
      currentMatchIndex = (currentMatchIndex - 1 + totalMatches) % totalMatches;
      scrollToMatch(currentMatchIndex);
    }
  };

  $.searchDown.onclick = () => {
    if (totalMatches > 0) {
      currentMatchIndex = (currentMatchIndex + 1) % totalMatches;
      scrollToMatch(currentMatchIndex);
    }
  };

  $.searchInput.addEventListener("input", (e) => {
    const term = e.target.value.trim().toLowerCase();
    clearHighlights();
    resetSearchState();
    if (term) {
      highlightMatches(term);
    }
  });

  $.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && totalMatches > 0) {
      e.preventDefault();
      if (e.shiftKey) {
        $.searchUp.click();
      } else {
        $.searchDown.click();
      }
    }
  });
}
