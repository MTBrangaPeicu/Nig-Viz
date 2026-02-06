<script>
  import { onDestroy, onMount } from 'svelte';

  export let title = '';
  export let options$; // Reactive options stream
  export let value$; // Reactive value stream
  export let id = 'better-text-default'; // Unique id passed from component

  let options = []; // Local reactive variable for options
  let value = ''; // Local reactive variable for value
  let unsubscribeOptions, unsubscribeValue;

  let currentFocus = -1; // Track keyboard highlight
  let textarea; // Reference to the textarea element
  let suggestionsBox; // Reference to the suggestions box element

  // Subscribe to the reactive options stream
  if (options$) {
    unsubscribeOptions = options$.subscribe((newOptions) => {
      options = newOptions || []; // Update options reactively
    });
  }

  // Subscribe to the reactive value stream
  if (value$) {
    unsubscribeValue = value$.subscribe((newValue) => {
      value = newValue || '';
    });
  }

  onDestroy(() => {
    if (unsubscribeOptions) unsubscribeOptions.unsubscribe();
    if (unsubscribeValue) unsubscribeValue.unsubscribe();
    if (suggestionsBox && suggestionsBox.parentNode) {
      document.body.removeChild(suggestionsBox); // Remove suggestions box from the DOM
    }
  });

  function updateValue(event) {
    if (value$) {
      value$.next(event.target.value); // Update the reactive value stream
    }
    showSuggestions(event.target.value);
    autoResizeTextarea(); // Resize as user types
  }

  function autoResizeTextarea() {
    if (!textarea) return;
    
    // Don't resize if container is collapsed (width too small to measure properly)
    const containerWidth = textarea.offsetWidth;
    if (containerWidth < 100) return;
    
    if (value && value.trim()) {
      textarea.style.height = 'auto';
      const newHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.max(80, newHeight)}px`;
    } else {
      textarea.style.height = ''; // Clear any inline style for empty textarea
    }
  }

  function showSuggestions(val) {
    const filtered = options.filter(opt => opt.toLowerCase().includes(val.toLowerCase()));
    if (!filtered.length) {
      closeSuggestions();
      return;
    }

    const rect = textarea.getBoundingClientRect();
    suggestionsBox.style.top = rect.bottom + window.scrollY + 'px';
    suggestionsBox.style.left = rect.left + window.scrollX + 'px';
    suggestionsBox.style.width = rect.width + 'px';
    suggestionsBox.innerHTML = filtered.map((opt, i) => 
      `<div class="suggestion-item" data-index="${i}">${opt}</div>`
    ).join('');
    suggestionsBox.style.display = 'block';

    currentFocus = -1;

    [...suggestionsBox.children].forEach(child => {
      child.addEventListener('mouseover', () => {
        removeActive();
        currentFocus = parseInt(child.dataset.index);
        addActive();
      });
      child.addEventListener('mouseout', () => {
        removeActive();
        currentFocus = -1;
      });
      child.addEventListener('click', () => {
        selectSuggestion(currentFocus);
      });
    });
  }

  function handleKeyDown(e) {
    const items = suggestionsBox.children;
    if (suggestionsBox.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      currentFocus++;
      if (currentFocus >= items.length) currentFocus = 0;
      addActive();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      currentFocus--;
      if (currentFocus < 0) currentFocus = items.length - 1;
      addActive();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (currentFocus > -1) {
        e.preventDefault();
        selectSuggestion(currentFocus);
      }
    }
  }

  function addActive() {
    removeActive();
    if (currentFocus > -1) {
      suggestionsBox.children[currentFocus].classList.add('suggestion-active');
      suggestionsBox.children[currentFocus].scrollIntoView({block: "nearest"});
    }
  }

  function removeActive() {
    [...suggestionsBox.children].forEach(item => {
      item.classList.remove('suggestion-active');
    });
  }

  function selectSuggestion(index) {
    if (index > -1) {
      value = suggestionsBox.children[index].textContent;
      textarea.value = value; // Sync textarea directly for immediate measurement
      updateValue({ target: { value } });
      autoResizeTextarea();
      closeSuggestions();
    }
  }

  function closeSuggestions() {
    suggestionsBox.style.display = 'none';
    currentFocus = -1;
  }

  // Append suggestions box to the document body
  onMount(() => {
    suggestionsBox = document.createElement('div');
    suggestionsBox.className = 'suggestions-box';
    suggestionsBox.style.position = 'absolute';
    suggestionsBox.style.maxHeight = '200px';
    suggestionsBox.style.overflowY = 'auto';
    suggestionsBox.style.zIndex = '1000';
    suggestionsBox.style.display = 'none';
    document.body.appendChild(suggestionsBox);

    // Auto-resize on mount if there's content and panel is visible
    autoResizeTextarea();

    const onClickOutside = (event) => {
      if (event.target !== textarea && !suggestionsBox.contains(event.target)) {
        closeSuggestions();
      }
    };

    document.addEventListener('click', onClickOutside);

    onDestroy(() => {
      document.removeEventListener('click', onClickOutside);
    });
  });
</script>

<div class="form-control w-full flex flex-col">
  {#if title}
    <label class="label" for="{id}-input">
      <span class="label-text font-semibold">{title}</span>
    </label>
  {/if}
  <textarea
    id="{id}-input"
    bind:this={textarea}
    bind:value={value}
    oninput={updateValue}
    onfocus={() => showSuggestions(value)}
    onkeydown={handleKeyDown}
    placeholder="Type or pick..."
    class="textarea textarea-bordered w-full h-20 text-sm"
  ></textarea>
</div>

<style>
/* Global styles for suggestions appended to body */
:global(.suggestions-box) {
  background: white !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 0.5rem !important;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
  overflow-y: auto !important;
  max-height: 200px !important;
}

:global(.suggestion-item) {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  user-select: none;
  font-size: 0.875rem;
  background: white;
  border-bottom: 1px solid #f3f4f6;
}

:global(.suggestion-item:last-child) {
  border-bottom: none;
}

:global(.suggestion-item:hover),
:global(.suggestion-active) {
  background-color: #dbeafe !important;
}

textarea {
  resize: vertical;
  overflow-y: auto;
}
</style>
