const form = document.getElementById("component-group-form");
if (form) {
  const boxes = [...document.querySelectorAll('input[name="literal"]')].filter((box) => box.form === form);
  const count = document.getElementById("component-selected-count");
  const selectAll = document.getElementById("component-select-all");
  const groupSelect = document.getElementById("component-group");
  const newGroup = document.getElementById("component-new-group");
  const update = () => {
    const selected = boxes.filter((box) => box.checked).length;
    if (count) count.textContent = `${selected} selected`;
    if (selectAll) {
      selectAll.checked = boxes.length > 0 && selected === boxes.length;
      selectAll.indeterminate = selected > 0 && selected < boxes.length;
    }
  };
  boxes.forEach((box) => box.addEventListener("change", update));
  selectAll?.addEventListener("change", () => {
    boxes.forEach((box) => { box.checked = selectAll.checked; });
    update();
  });
  groupSelect?.addEventListener("change", () => {
    if (newGroup) newGroup.hidden = groupSelect.value !== "new";
  });
  if (newGroup) newGroup.hidden = true;
  update();
}
