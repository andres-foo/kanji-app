(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.querySelectorAll(".stroke-play").forEach((button) => {
    const card = button.closest(".card");
    const svg = card?.querySelector(".stroke-order svg");
    if (!svg) return;

    const paths = [...svg.querySelectorAll("path")];
    const numbers = [...svg.querySelectorAll('g[id^="kvg:StrokeNumbers"] text')];
    if (!paths.length || reduce) return;

    button.hidden = false;
    let animations = [];
    let timer = 0;

    const reset = () => {
      animations.forEach((animation) => animation.cancel());
      animations = [];
      clearTimeout(timer);
      paths.forEach((path) => {
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
      });
      numbers.forEach((number) => {
        number.style.opacity = "";
      });
    };

    const play = () => {
      reset();

      const step = 430;
      const duration = 340;
      paths.forEach((path, index) => {
        const length = path.getTotalLength();
        path.style.strokeDasharray = `${length}`;
        path.style.strokeDashoffset = `${length}`;
        animations.push(path.animate(
          [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
          { duration, delay: index * step, easing: "ease-in-out", fill: "both" },
        ));

        if (numbers[index]) {
          numbers[index].style.opacity = "0";
          animations.push(numbers[index].animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: 180, delay: index * step + duration * 0.6, fill: "both" },
          ));
        }
      });

      button.disabled = true;
      button.textContent = "Playing";
      button.setAttribute("aria-label", "Playing stroke order animation");

      const total = (paths.length - 1) * step + duration + 120;
      timer = window.setTimeout(() => {
        reset();
        button.disabled = false;
        button.textContent = "Replay";
        button.setAttribute("aria-label", "Replay stroke order animation");
      }, total);
    };

    button.addEventListener("click", play);
  });
})();
