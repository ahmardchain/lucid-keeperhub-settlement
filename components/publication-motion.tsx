"use client";
import { useEffect } from "react";

export function PublicationMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const sections = document.querySelectorAll<HTMLElement>(".thesis-strip,.section-heading,.settlement-instrument,.recovery-matrix,.implementation-section,.ledger-wrap");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("print-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    sections.forEach((section) => { section.classList.add("print-reveal"); observer.observe(section); });
    return () => { observer.disconnect(); sections.forEach((section) => section.classList.remove("print-reveal", "print-visible")); };
  }, []);
  return null;
}
