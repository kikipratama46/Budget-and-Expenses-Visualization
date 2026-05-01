(function() {
  'use strict';

  /**
   * @typedef {Object} Transaction
   * @property {string} id         - Unique identifier (crypto.randomUUID() or Date.now().toString() fallback)
   * @property {string} name       - Non-empty, trimmed display name
   * @property {number} amount     - Positive float; stored as a number, not a string
   * @property {string} category   - Must match a name in AppState.categories
   * @property {string} date       - ISO 8601 local date string: "YYYY-MM-DD"
   */

  /**
   * @typedef {Object} Category
   * @property {string}      name  - Unique (case-insensitive), trimmed category label
   * @property {number|null} limit - null = no limit set; positive number = spending limit
   */

  const _now = new Date();
  const currentYear  = _now.getFullYear();
  const currentMonth = _now.getMonth() + 1; // getMonth() is 0-indexed; store as 1-indexed

  /**
   * Single in-memory source of truth for the application.
   * Every user action mutates AppState, then triggers render() and Storage.save().
   *
   * @type {{ transactions: Transaction[], categories: Category[], selectedMonth: { year: number, month: number } }}
   */
  const AppState = {
    transactions: [],
    categories: [
      { name: 'Food',      limit: null },
      { name: 'Transport', limit: null },
      { name: 'Fun',       limit: null }
    ],
    selectedMonth: {
      year:  currentYear,
      month: currentMonth
    }
  };

  // ---------------------------------------------------------------------------
  // Toast helper
  // ---------------------------------------------------------------------------

  /**
   * Displays a temporary toast notification at the bottom of the screen.
   *
   * @param {string} message - The message to display.
   * @param {'info'|'error'|'warning'} [type='info'] - Visual style of the toast.
   */
  function showToast(message, type) {
    const toastType = type || 'info';

    const toast = document.createElement('div');
    toast.className = 'toast toast--' + toastType;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.textContent = message;

    // Ensure a toast container exists
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    container.appendChild(toast);

    // Trigger fade-in on next frame
    requestAnimationFrame(function() {
      toast.classList.add('toast--visible');
    });

    // Auto-remove after 4 seconds
    setTimeout(function() {
      toast.classList.remove('toast--visible');
      toast.addEventListener('transitionend', function() {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, { once: true });
    }, 4000);
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  /**
   * Handles reading and writing AppState to localStorage.
   * All localStorage calls are wrapped in try/catch per the error-handling design.
   * selectedMonth is intentionally NOT persisted — it resets to the current month on every load.
   */
  const Storage = {
    KEYS: {
      TRANSACTIONS: 'ebv_transactions',
      CATEGORIES:   'ebv_categories'
    },

    /**
     * Default categories used when stored data is absent or corrupted.
     * @type {Category[]}
     */
    _defaultCategories: [
      { name: 'Food',      limit: null },
      { name: 'Transport', limit: null },
      { name: 'Fun',       limit: null }
    ],

    /**
     * Serializes state.transactions and state.categories to localStorage.
     * On QuotaExceededError shows a storage-full toast.
     * On any other write error shows a generic save-failure toast.
     *
     * @param {{ transactions: Transaction[], categories: Category[] }} state
     */
    save: function(state) {
      try {
        localStorage.setItem(this.KEYS.TRANSACTIONS, JSON.stringify(state.transactions));
        localStorage.setItem(this.KEYS.CATEGORIES,   JSON.stringify(state.categories));
      } catch (err) {
        if (
          err instanceof DOMException &&
          (err.name === 'QuotaExceededError' ||
           err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
           err.code === 22)
        ) {
          showToast('Storage is full. Your latest changes could not be saved.', 'error');
        } else {
          showToast('Could not save your data. Please try again.', 'error');
        }
      }
    },

    /**
     * Reads and parses both localStorage keys.
     * Validates that parsed values are arrays and that each item has required fields.
     * Discards and replaces with defaults any corrupted data; emits console.warn for discarded data.
     * Returns {} when localStorage is unavailable so the app starts with defaults.
     *
     * @returns {Partial<{ transactions: Transaction[], categories: Category[] }>}
     */
    load: function() {
      var rawTransactions;
      var rawCategories;

      // Attempt to read from localStorage; return {} if unavailable
      try {
        rawTransactions = localStorage.getItem(this.KEYS.TRANSACTIONS);
        rawCategories   = localStorage.getItem(this.KEYS.CATEGORIES);
      } catch (err) {
        // localStorage is unavailable (e.g., private browsing with strict settings)
        return {};
      }

      var result = {};

      // --- Parse and validate transactions ---
      if (rawTransactions !== null) {
        var parsedTransactions;
        try {
          parsedTransactions = JSON.parse(rawTransactions);
        } catch (err) {
          console.warn('[Storage] Failed to parse ebv_transactions; discarding corrupted data.', err);
          parsedTransactions = null;
        }

        if (!Array.isArray(parsedTransactions)) {
          console.warn('[Storage] ebv_transactions is not an array; discarding corrupted data.');
          result.transactions = [];
        } else {
          var validTransactions = [];
          var discardedTransactions = 0;

          for (var i = 0; i < parsedTransactions.length; i++) {
            var t = parsedTransactions[i];
            if (
              t !== null &&
              typeof t === 'object' &&
              typeof t.id       === 'string' &&
              typeof t.name     === 'string' &&
              typeof t.amount   === 'number' &&
              typeof t.category === 'string' &&
              typeof t.date     === 'string'
            ) {
              validTransactions.push(t);
            } else {
              discardedTransactions++;
            }
          }

          if (discardedTransactions > 0) {
            console.warn(
              '[Storage] Discarded ' + discardedTransactions +
              ' invalid transaction(s) from ebv_transactions.'
            );
          }

          result.transactions = validTransactions;
        }
      }

      // --- Parse and validate categories ---
      if (rawCategories !== null) {
        var parsedCategories;
        try {
          parsedCategories = JSON.parse(rawCategories);
        } catch (err) {
          console.warn('[Storage] Failed to parse ebv_categories; discarding corrupted data.', err);
          parsedCategories = null;
        }

        if (!Array.isArray(parsedCategories)) {
          console.warn('[Storage] ebv_categories is not an array; discarding corrupted data.');
          result.categories = this._defaultCategories.slice();
        } else {
          var validCategories = [];
          var discardedCategories = 0;

          for (var j = 0; j < parsedCategories.length; j++) {
            var c = parsedCategories[j];
            if (
              c !== null &&
              typeof c === 'object' &&
              typeof c.name === 'string'
            ) {
              validCategories.push(c);
            } else {
              discardedCategories++;
            }
          }

          if (discardedCategories > 0) {
            console.warn(
              '[Storage] Discarded ' + discardedCategories +
              ' invalid category/categories from ebv_categories.'
            );
          }

          // If all categories were corrupted, fall back to defaults
          if (validCategories.length === 0 && parsedCategories.length > 0) {
            console.warn('[Storage] All categories were invalid; restoring defaults.');
            result.categories = this._defaultCategories.slice();
          } else {
            result.categories = validCategories;
          }
        }
      }

      return result;
    }
  };

  // ---------------------------------------------------------------------------
  // Validator
  // ---------------------------------------------------------------------------

  /**
   * Pure validation functions for form inputs.
   * Each function returns a ValidationResult: { valid: boolean, error: string | null }.
   *
   * @typedef {Object} ValidationResult
   * @property {boolean}     valid - true if the input passes validation
   * @property {string|null} error - user-friendly error message, or null when valid
   */
  const Validator = {
    /**
     * Validates a transaction name.
     * Rejects empty strings and strings that are entirely whitespace.
     *
     * @param {string} name
     * @returns {ValidationResult}
     */
    validateName: function(name) {
      if (!name || name.trim() === '') {
        return { valid: false, error: 'Item name is required.' };
      }
      return { valid: true, error: null };
    },

    /**
     * Validates a transaction amount string from a form input.
     * Parses with parseFloat; rejects non-numeric strings, zero, and negative values.
     *
     * @param {string} amount
     * @returns {ValidationResult}
     */
    validateAmount: function(amount) {
      var parsed = parseFloat(amount);
      if (!isFinite(parsed) || parsed <= 0) {
        return { valid: false, error: 'Please enter a positive amount.' };
      }
      return { valid: true, error: null };
    },

    /**
     * Validates that a category has been selected.
     * Rejects empty strings and other falsy values.
     *
     * @param {string} category
     * @returns {ValidationResult}
     */
    validateCategory: function(category) {
      if (!category) {
        return { valid: false, error: 'Please select a category.' };
      }
      return { valid: true, error: null };
    },

    /**
     * Validates a new category name against the list of existing categories.
     * Rejects empty/whitespace-only names and names that match an existing
     * category name case-insensitively.
     *
     * @param {string}     name     - The proposed new category name.
     * @param {Category[]} existing - Array of existing Category objects.
     * @returns {ValidationResult}
     */
    validateCategoryName: function(name, existing) {
      if (!name || name.trim() === '') {
        return { valid: false, error: 'Category name is required.' };
      }
      var trimmedLower = name.trim().toLowerCase();
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].name.toLowerCase() === trimmedLower) {
          return { valid: false, error: 'Category name already exists.' };
        }
      }
      return { valid: true, error: null };
    },

    /**
     * Validates a spending limit string from a form input.
     * Parses with parseFloat; rejects non-numeric strings, zero, and negative values.
     *
     * @param {string} limit
     * @returns {ValidationResult}
     */
    validateSpendingLimit: function(limit) {
      var parsed = parseFloat(limit);
      if (!isFinite(parsed) || parsed <= 0) {
        return { valid: false, error: 'Please enter a valid spending limit.' };
      }
      return { valid: true, error: null };
    }
  };

  // ---------------------------------------------------------------------------
  // TransactionManager
  // ---------------------------------------------------------------------------

  /**
   * Handles adding and deleting transactions in AppState.
   */
  const TransactionManager = {
    /**
     * Creates a new Transaction and prepends it to AppState.transactions.
     *
     * @param {string} name     - Display name from the form (will be trimmed).
     * @param {string} amount   - Amount string from the form (will be parsed with parseFloat).
     * @param {string} category - Category name; must match an entry in AppState.categories.
     * @returns {Transaction}   The newly created transaction.
     */
    add: function(name, amount, category) {
      var id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : Date.now().toString();

      var transaction = {
        id:       id,
        name:     name.trim(),
        amount:   parseFloat(amount),
        category: category,
        date:     new Date().toISOString().slice(0, 10)
      };

      AppState.transactions = [transaction].concat(AppState.transactions);

      return transaction;
    },

    /**
     * Removes the transaction with the given id from AppState.transactions.
     *
     * @param {string} id - The id of the transaction to remove.
     */
    delete: function(id) {
      AppState.transactions = AppState.transactions.filter(function(t) {
        return t.id !== id;
      });
    }
  };

  // ---------------------------------------------------------------------------
  // CategoryManager
  // ---------------------------------------------------------------------------

  /**
   * Handles adding categories and managing spending limits.
   */
  const CategoryManager = {
    /**
     * Creates a new Category with a trimmed name and null limit,
     * then appends it to AppState.categories.
     *
     * @param {string} name - The new category name (will be trimmed).
     * @returns {Category}  The newly created category.
     */
    add: function(name) {
      var category = {
        name:  name.trim(),
        limit: null
      };

      AppState.categories = AppState.categories.concat([category]);

      return category;
    },

    /**
     * Finds the category with the given name (exact match) and sets its limit
     * to the parsed float value of the provided limit string.
     *
     * @param {string} categoryName - The exact name of the category to update.
     * @param {string|number} limit - The new spending limit (parsed with parseFloat).
     */
    setLimit: function(categoryName, limit) {
      for (var i = 0; i < AppState.categories.length; i++) {
        if (AppState.categories[i].name === categoryName) {
          AppState.categories[i].limit = parseFloat(limit);
          return;
        }
      }
    },

    /**
     * Computes the total spending per category for the given transactions.
     * Only categories that have at least one transaction appear in the result.
     *
     * @param {Transaction[]} transactions - Array of transactions to aggregate.
     * @returns {Map<string, number>} Map of category name → sum of amounts.
     */
    getCategoryTotals: function(transactions) {
      var totals = new Map();

      for (var i = 0; i < transactions.length; i++) {
        var t = transactions[i];
        var current = totals.has(t.category) ? totals.get(t.category) : 0;
        totals.set(t.category, current + t.amount);
      }

      return totals;
    }
  };


  // ---------------------------------------------------------------------------
  // ChartManager
  // ---------------------------------------------------------------------------

  /**
   * Wraps the Chart.js instance. Owns the <canvas> element lifecycle.
   * Chart.js is expected to be loaded as a global `Chart` object via CDN.
   */
  const ChartManager = {
    /**
     * The active Chart.js instance, or null when not initialized.
     * @type {Chart|null}
     */
    chart: null,

    /**
     * Creates a Chart.js 'pie' instance on the given canvas element.
     * Guards against double-init: returns early if a chart already exists.
     * Guards against Chart.js not being loaded.
     *
     * @param {string} canvasId - The id of the <canvas> element to render into.
     */
    init: function(canvasId) {
      if (this.chart) return;

      if (typeof Chart === 'undefined') {
        console.warn('[ChartManager] Chart.js is not loaded. Pie chart will not be rendered.');
        return;
      }

      var canvas = document.getElementById(canvasId);
      if (!canvas) {
        console.warn('[ChartManager] Canvas element not found: ' + canvasId);
        return;
      }

      this.chart = new Chart(canvas, {
        type: 'pie',
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: [],
            borderColor: [],
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: {
              display: true,
              position: 'bottom'
            }
          }
        }
      });
    },

    /**
     * Updates the chart with new data and calls chart.update().
     * For over-limit segments, applies a red border (width 3).
     * For normal segments, applies a transparent border.
     * When labels/data are empty, shows an empty chart (no segments).
     *
     * @param {{ labels: string[], data: number[], backgroundColors: string[], overLimitCategories: string[] }} data
     */
    update: function(data) {
      if (!this.chart) return;

      var overLimitSet = {};
      for (var i = 0; i < data.overLimitCategories.length; i++) {
        overLimitSet[data.overLimitCategories[i]] = true;
      }

      var borderColors = [];
      var borderWidths = [];
      for (var j = 0; j < data.labels.length; j++) {
        if (overLimitSet[data.labels[j]]) {
          borderColors.push('#FF0000');
          borderWidths.push(3);
        } else {
          borderColors.push('transparent');
          borderWidths.push(1);
        }
      }

      this.chart.data.labels = data.labels;
      this.chart.data.datasets[0].data = data.data;
      this.chart.data.datasets[0].backgroundColor = data.backgroundColors;
      this.chart.data.datasets[0].borderColor = borderColors;
      this.chart.data.datasets[0].borderWidth = borderWidths;

      this.chart.update();
    },

    /**
     * Destroys the Chart.js instance and nulls the reference.
     */
    destroy: function() {
      if (this.chart) {
        this.chart.destroy();
        this.chart = null;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Renderer
  // ---------------------------------------------------------------------------

  /**
   * Fixed color palette for pie chart segments.
   * Cycles through if there are more categories than palette entries.
   */
  var CHART_PALETTE = [
    '#FF6384',
    '#36A2EB',
    '#FFCE56',
    '#4BC0C0',
    '#9966FF',
    '#FF9F40',
    '#C9CBCF',
    '#E7E9ED'
  ];

  /**
   * Formats a number as a USD currency string, e.g. "$12.50".
   *
   * @param {number} amount
   * @returns {string}
   */
  function formatCurrency(amount) {
    return '$' + amount.toFixed(2);
  }

  /**
   * Determines whether a category is over its spending limit.
   *
   * @param {Category} category
   * @param {Map<string, number>} categoryTotals
   * @returns {boolean}
   */
  function isOverLimit(category, categoryTotals) {
    if (category.limit === null) return false;
    var total = categoryTotals.has(category.name) ? categoryTotals.get(category.name) : 0;
    return total >= category.limit;
  }

  /**
   * Task 6.1 — Renders the balance display.
   * Computes the total balance from all transactions and updates #balance-display.
   *
   * @param {{ transactions: Transaction[], categories: Category[], selectedMonth: { year: number, month: number } }} state
   */
  function renderBalanceDisplay(state) {
    var balance = state.transactions.reduce(function(s, t) { return s + t.amount; }, 0);
    var el = document.querySelector('#balance-display .balance-amount');
    if (el) {
      el.textContent = formatCurrency(balance);
    }
  }

  /**
   * Task 6.2 — Clears and rebuilds #transaction-list.
   * Each <li> shows name, formatted amount, category badge, and a delete button.
   * Items whose category is over its limit receive the CSS class "over-limit".
   *
   * @param {{ transactions: Transaction[], categories: Category[], selectedMonth: { year: number, month: number } }} state
   */
  function renderTransactionList(state) {
    var list = document.getElementById('transaction-list');
    if (!list) return;

    // Clear existing content
    list.innerHTML = '';

    if (state.transactions.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'transaction-list__empty';
      empty.textContent = 'No transactions yet. Add one above!';
      list.appendChild(empty);
      return;
    }

    var categoryTotals = CategoryManager.getCategoryTotals(state.transactions);

    // Build a quick lookup: category name → limit
    var categoryLimitMap = {};
    for (var i = 0; i < state.categories.length; i++) {
      categoryLimitMap[state.categories[i].name] = state.categories[i];
    }

    for (var j = 0; j < state.transactions.length; j++) {
      var t = state.transactions[j];

      var li = document.createElement('li');
      li.className = 'transaction-item';

      // Check over-limit for this transaction's category
      var cat = categoryLimitMap[t.category];
      if (cat && cat.limit !== null) {
        var catTotal = categoryTotals.has(t.category) ? categoryTotals.get(t.category) : 0;
        if (catTotal >= cat.limit) {
          li.classList.add('over-limit');
        }
      }

      // Name
      var nameSpan = document.createElement('span');
      nameSpan.className = 'transaction-item__name';
      nameSpan.textContent = t.name;

      // Amount
      var amountSpan = document.createElement('span');
      amountSpan.className = 'transaction-item__amount';
      amountSpan.textContent = formatCurrency(t.amount);

      // Category badge
      var categoryBadge = document.createElement('span');
      categoryBadge.className = 'transaction-item__category';
      categoryBadge.textContent = t.category;

      // Delete button
      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger transaction-item__delete';
      deleteBtn.setAttribute('data-id', t.id);
      deleteBtn.setAttribute('aria-label', 'Delete transaction: ' + t.name);
      deleteBtn.textContent = 'Delete';

      li.appendChild(nameSpan);
      li.appendChild(amountSpan);
      li.appendChild(categoryBadge);
      li.appendChild(deleteBtn);

      list.appendChild(li);
    }
  }

  /**
   * Task 6.3 — Derives chart data from category totals and calls ChartManager.update().
   * Applies a distinct border color to over-limit segments.
   * Guards against ChartManager being unavailable (Task 7.1 not yet implemented).
   *
   * @param {{ transactions: Transaction[], categories: Category[], selectedMonth: { year: number, month: number } }} state
   */
  function renderPieChart(state) {
    if (typeof ChartManager === 'undefined' || !ChartManager.chart) return;

    if (state.transactions.length === 0) {
      ChartManager.update({ labels: [], data: [], backgroundColors: [], overLimitCategories: [] });
      return;
    }

    var categoryTotals = CategoryManager.getCategoryTotals(state.transactions);

    var labels = [];
    var data = [];
    var backgroundColors = [];
    var overLimitCategories = [];

    // Build a quick lookup: category name → category object
    var categoryMap = {};
    for (var i = 0; i < state.categories.length; i++) {
      categoryMap[state.categories[i].name] = state.categories[i];
    }

    var paletteIndex = 0;
    categoryTotals.forEach(function(total, categoryName) {
      labels.push(categoryName);
      data.push(total);
      backgroundColors.push(CHART_PALETTE[paletteIndex % CHART_PALETTE.length]);
      paletteIndex++;

      var cat = categoryMap[categoryName];
      if (cat && cat.limit !== null && total >= cat.limit) {
        overLimitCategories.push(categoryName);
      }
    });

    ChartManager.update({
      labels: labels,
      data: data,
      backgroundColors: backgroundColors,
      overLimitCategories: overLimitCategories
    });
  }

  /**
   * Task 6.4 — Rebuilds the category list in #category-manager and
   * populates the category <select> in #transaction-form.
   *
   * @param {{ transactions: Transaction[], categories: Category[], selectedMonth: { year: number, month: number } }} state
   */
  function renderCategoryManager(state) {
    // --- Rebuild #category-list ---
    var categoryList = document.getElementById('category-list');
    if (categoryList) {
      categoryList.innerHTML = '';

      for (var i = 0; i < state.categories.length; i++) {
        var cat = state.categories[i];

        var row = document.createElement('div');
        row.className = 'category-row';

        var nameSpan = document.createElement('span');
        nameSpan.className = 'category-row__name';
        nameSpan.textContent = cat.name;

        var limitInput = document.createElement('input');
        limitInput.type = 'number';
        limitInput.className = 'category-row__limit-input';
        limitInput.placeholder = 'No limit';
        limitInput.min = '0.01';
        limitInput.step = '0.01';
        limitInput.setAttribute('aria-label', 'Spending limit for ' + cat.name);
        if (cat.limit !== null) {
          limitInput.value = cat.limit;
        }

        var setBtn = document.createElement('button');
        setBtn.type = 'button';
        setBtn.className = 'btn btn-secondary category-row__set-btn';
        setBtn.setAttribute('data-category', cat.name);
        setBtn.textContent = 'Set';

        row.appendChild(nameSpan);
        row.appendChild(limitInput);
        row.appendChild(setBtn);

        categoryList.appendChild(row);
      }
    }

    // --- Populate #category-select in #transaction-form ---
    var categorySelect = document.getElementById('category-select');
    if (categorySelect) {
      // Preserve the default placeholder option
      categorySelect.innerHTML = '<option value="">-- Select a category --</option>';

      for (var j = 0; j < state.categories.length; j++) {
        var option = document.createElement('option');
        option.value = state.categories[j].name;
        option.textContent = state.categories[j].name;
        categorySelect.appendChild(option);
      }
    }
  }

  /**
   * Task 6.5 — Renders the monthly summary table for state.selectedMonth.
   * Filters transactions to the selected month, computes per-category totals,
   * and renders a table (or a "no data" message) in #monthly-summary-content.
   * Also populates the year selector and sets both selectors to the current selectedMonth.
   *
   * @param {{ transactions: Transaction[], categories: Category[], selectedMonth: { year: number, month: number } }} state
   */
  function renderMonthlySummary(state) {
    var selectedYear  = state.selectedMonth.year;
    var selectedMonth = state.selectedMonth.month;

    // Build the YYYY-MM prefix for date comparison
    var monthStr = selectedMonth < 10 ? '0' + selectedMonth : '' + selectedMonth;
    var prefix   = selectedYear + '-' + monthStr;

    // Filter transactions to the selected month
    var filtered = state.transactions.filter(function(t) {
      return t.date.indexOf(prefix) === 0;
    });

    // Compute per-category totals for the filtered transactions
    var totals = CategoryManager.getCategoryTotals(filtered);

    // --- Render #monthly-summary-content ---
    var content = document.getElementById('monthly-summary-content');
    if (content) {
      content.innerHTML = '';

      if (totals.size === 0) {
        var noData = document.createElement('p');
        noData.textContent = 'No data available for this period.';
        content.appendChild(noData);
      } else {
        var table = document.createElement('table');
        table.className = 'monthly-summary-table';

        var thead = document.createElement('thead');
        var headerRow = document.createElement('tr');
        var thCategory = document.createElement('th');
        thCategory.textContent = 'Category';
        var thTotal = document.createElement('th');
        thTotal.textContent = 'Total';
        headerRow.appendChild(thCategory);
        headerRow.appendChild(thTotal);
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        totals.forEach(function(total, categoryName) {
          var tr = document.createElement('tr');
          var tdCategory = document.createElement('td');
          tdCategory.textContent = categoryName;
          var tdTotal = document.createElement('td');
          tdTotal.textContent = formatCurrency(total);
          tr.appendChild(tdCategory);
          tr.appendChild(tdTotal);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        content.appendChild(table);
      }
    }

    // --- Set #summary-month select value ---
    var summaryMonth = document.getElementById('summary-month');
    if (summaryMonth) {
      summaryMonth.value = String(selectedMonth);
    }

    // --- Populate and set #summary-year select ---
    var summaryYear = document.getElementById('summary-year');
    if (summaryYear) {
      summaryYear.innerHTML = '';
      var startYear = currentYear - 2;
      var endYear   = currentYear + 1;
      for (var y = startYear; y <= endYear; y++) {
        var option = document.createElement('option');
        option.value = String(y);
        option.textContent = String(y);
        summaryYear.appendChild(option);
      }
      summaryYear.value = String(selectedYear);
    }
  }

  // ---------------------------------------------------------------------------
  // Renderer object (Task 6.6)
  // ---------------------------------------------------------------------------

  /**
   * Renderer — calls all five render functions in order.
   */
  const Renderer = {
    /**
     * Calls all render functions to fully update the UI from the given state.
     *
     * @param {{ transactions: Transaction[], categories: Category[], selectedMonth: { year: number, month: number } }} state
     */
    renderAll: function(state) {
      renderBalanceDisplay(state);
      renderTransactionList(state);
      renderPieChart(state);
      renderCategoryManager(state);
      renderMonthlySummary(state);
    }
  };

  // ---------------------------------------------------------------------------
  // EventHandlers
  // ---------------------------------------------------------------------------

  /**
   * Handles submission of the transaction form.
   * Validates all fields, shows inline errors for failures, and on full success
   * adds the transaction, persists state, re-renders, and resets the form.
   *
   * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
   *
   * @param {Event} e
   */
  function onTransactionFormSubmit(e) {
    e.preventDefault();

    var nameInput     = document.getElementById('item-name');
    var amountInput   = document.getElementById('amount');
    var categoryInput = document.getElementById('category-select');

    var nameValue     = nameInput     ? nameInput.value     : '';
    var amountValue   = amountInput   ? amountInput.value   : '';
    var categoryValue = categoryInput ? categoryInput.value : '';

    var nameResult     = Validator.validateName(nameValue);
    var amountResult   = Validator.validateAmount(amountValue);
    var categoryResult = Validator.validateCategory(categoryValue);

    // Show or clear inline error for each field
    var nameError     = document.getElementById('item-name-error');
    var amountError   = document.getElementById('amount-error');
    var categoryError = document.getElementById('category-error');

    if (nameError) {
      nameError.textContent = nameResult.valid ? '' : nameResult.error;
    }
    if (amountError) {
      amountError.textContent = amountResult.valid ? '' : amountResult.error;
    }
    if (categoryError) {
      categoryError.textContent = categoryResult.valid ? '' : categoryResult.error;
    }

    // Only proceed when all three fields pass
    if (!nameResult.valid || !amountResult.valid || !categoryResult.valid) {
      return;
    }

    TransactionManager.add(nameValue, amountValue, categoryValue);
    Storage.save(AppState);
    Renderer.renderAll(AppState);

    // Reset the form (clear all fields)
    if (nameInput)     nameInput.value     = '';
    if (amountInput)   amountInput.value   = '';
    if (categoryInput) categoryInput.value = '';
    if (nameError)     nameError.textContent     = '';
    if (amountError)   amountError.textContent   = '';
    if (categoryError) categoryError.textContent = '';
  }

  /**
   * Deletes a transaction by id, persists state, and re-renders.
   *
   * Requirements: 2.5, 3.3, 4.3, 8.2
   *
   * @param {string} id
   */
  function onDeleteTransaction(id) {
    TransactionManager.delete(id);
    Storage.save(AppState);
    Renderer.renderAll(AppState);
  }

  /**
   * Handles submission of the add-category form.
   * Validates the new category name, shows an inline error on failure, and on
   * success adds the category, persists state, re-renders, and clears the input.
   *
   * Requirements: 5.2, 5.3, 5.4, 5.5
   *
   * @param {Event} e
   */
  function onAddCategory(e) {
    e.preventDefault();

    var nameInput = document.getElementById('new-category-name');
    var nameValue = nameInput ? nameInput.value : '';

    var result = Validator.validateCategoryName(nameValue, AppState.categories);

    var errorSpan = document.getElementById('new-category-error');
    if (errorSpan) {
      errorSpan.textContent = result.valid ? '' : result.error;
    }

    if (!result.valid) {
      return;
    }

    CategoryManager.add(nameValue);
    Storage.save(AppState);
    Renderer.renderAll(AppState);

    if (nameInput) nameInput.value = '';
    if (errorSpan) errorSpan.textContent = '';
  }

  /**
   * Validates and applies a spending limit for a category.
   * Shows an inline error adjacent to the limit input on failure.
   * On success, updates the limit, persists state, and re-renders.
   *
   * Requirements: 6.1, 6.2, 6.3, 6.5
   *
   * @param {string} categoryName
   * @param {string} limitValue
   */
  function onSetSpendingLimit(categoryName, limitValue) {
    var result = Validator.validateSpendingLimit(limitValue);

    // Find the category row for this category and show/clear the error
    var categoryList = document.getElementById('category-list');
    if (categoryList) {
      var rows = categoryList.querySelectorAll('.category-row');
      for (var i = 0; i < rows.length; i++) {
        var setBtn = rows[i].querySelector('[data-category]');
        if (setBtn && setBtn.getAttribute('data-category') === categoryName) {
          // Look for an existing error span, or create one adjacent to the input
          var existingError = rows[i].querySelector('.error-msg');
          if (!result.valid) {
            if (!existingError) {
              existingError = document.createElement('span');
              existingError.className = 'error-msg';
              existingError.setAttribute('role', 'alert');
              rows[i].appendChild(existingError);
            }
            existingError.textContent = result.error;
          } else {
            if (existingError) {
              existingError.textContent = '';
            }
          }
          break;
        }
      }
    }

    if (!result.valid) {
      return;
    }

    CategoryManager.setLimit(categoryName, limitValue);
    Storage.save(AppState);
    Renderer.renderAll(AppState);
  }

  /**
   * Updates the selected month in AppState and re-renders.
   * selectedMonth is not persisted — it resets to the current month on reload.
   *
   * Requirements: 7.2, 7.3
   *
   * @param {string|number} year
   * @param {string|number} month
   */
  function onMonthChange(year, month) {
    AppState.selectedMonth = {
      year:  parseInt(year,  10),
      month: parseInt(month, 10)
    };
    Renderer.renderAll(AppState);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap — DOMContentLoaded
  // ---------------------------------------------------------------------------

  /**
   * Wires all event listeners and initialises the app once the DOM is ready.
   *
   * Requirements: 8.3, 10.3
   */
  document.addEventListener('DOMContentLoaded', function() {
    // 1. Load persisted state and merge into AppState
    var loaded = Storage.load();
    if (loaded.transactions) {
      AppState.transactions = loaded.transactions;
    }
    if (loaded.categories) {
      AppState.categories = loaded.categories;
    }

    // 2. Initialise the pie chart
    ChartManager.init('pie-chart');

    // 3. Initial render
    Renderer.renderAll(AppState);

    // --- Wire event listeners ---

    // Transaction form submit
    var transactionForm = document.getElementById('transaction-form');
    if (transactionForm) {
      transactionForm.addEventListener('submit', onTransactionFormSubmit);
    }

    // Delete transaction — event delegation on #transaction-list
    var transactionList = document.getElementById('transaction-list');
    if (transactionList) {
      transactionList.addEventListener('click', function(event) {
        var id = event.target.getAttribute('data-id');
        if (id) {
          onDeleteTransaction(id);
        }
      });
    }

    // Add category form submit
    var addCategoryForm = document.getElementById('add-category-form');
    if (addCategoryForm) {
      addCategoryForm.addEventListener('submit', onAddCategory);
    }

    // Set spending limit — event delegation on #category-list
    var categoryList = document.getElementById('category-list');
    if (categoryList) {
      categoryList.addEventListener('click', function(event) {
        var categoryName = event.target.getAttribute('data-category');
        if (categoryName) {
          // Find the sibling limit input in the same .category-row
          var row = event.target.closest('.category-row');
          if (row) {
            var limitInput = row.querySelector('.category-row__limit-input');
            var limitValue = limitInput ? limitInput.value : '';
            onSetSpendingLimit(categoryName, limitValue);
          }
        }
      });
    }

    // Month/year selectors — re-render summary on change
    var summaryMonth = document.getElementById('summary-month');
    var summaryYear  = document.getElementById('summary-year');

    function handleMonthYearChange() {
      var yearVal  = summaryYear  ? summaryYear.value  : String(currentYear);
      var monthVal = summaryMonth ? summaryMonth.value : String(currentMonth);
      onMonthChange(yearVal, monthVal);
    }

    if (summaryMonth) {
      summaryMonth.addEventListener('change', handleMonthYearChange);
    }
    if (summaryYear) {
      summaryYear.addEventListener('change', handleMonthYearChange);
    }
  });

})();
