/* Shared procedural artwork for the desktop actor and settings thumbnail. */
(function () {
  "use strict";
  window.petSpiderMarkup = function (thumbnail) {
    return `<svg ${thumbnail ? '' : 'id="spider"'} class="${thumbnail ? 'spider-thumbnail' : 'actor'}" viewBox="0 0 108 100" role="img" aria-label="Q版蜘蛛侠">
      <style>
        .sp-eye { transform-box:fill-box;transform-origin:center; }
        .blinking .sp-eye { transform:scaleY(.08); }
        .sp-arm { transform-box:fill-box;transform-origin:50% 15%; }
        .sp-web,.sp-device,.sp-rest { display:none; }
        .s-working .sp-device,.s-asking .sp-web,.s-sleep .sp-rest { display:block; }
        .s-working .sp-arm { animation:sp-tap .4s ease-in-out infinite alternate; }
        .s-working .sp-right { animation-delay:-.4s; }
        .s-asking .sp-right { transform:rotate(-135deg); }
        .s-asking .sp-web { stroke-dasharray:5 2;animation:sp-thread .7s linear infinite; }
        .s-done #spider { animation:sp-cheer 1s ease-in-out infinite; }
        .s-done .sp-arm { transform:rotate(145deg); }
        .s-done .sp-right { transform:rotate(-145deg); }
        .s-error #spider { animation:sp-shake .6s ease-in-out infinite; }
        .s-error .sp-eye { transform:scaleY(.65); }
        .s-sleep #spider { transform:rotate(-9deg); }
        .s-sleep .sp-eye { display:none; }
        @keyframes sp-tap { to { transform:rotate(28deg) translateY(-3px); } }
        @keyframes sp-thread { to { stroke-dashoffset:-14; } }
        @keyframes sp-cheer { 0%,100% { transform:translateY(0) rotate(-5deg); } 50% { transform:translateY(-9px) rotate(5deg); } }
        @keyframes sp-shake { 0%,100% { transform:rotate(0); } 25% { transform:rotate(-4deg); } 75% { transform:rotate(4deg); } }
        @media (prefers-reduced-motion:reduce) { #spider,.spider-thumbnail * { animation:none!important;transition:none!important; } }
      </style>
      <g stroke="#171923" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
        <path class="sp-web" d="M91 65 Q98 34 103 3 M98 24 l-8 -6 m8 6 l7 -7" fill="none" stroke="#637a96" stroke-width="2.5"/>
        <path d="M40 77 L37 94 Q40 99 48 96 L54 81 L61 96 Q70 99 72 94 L68 77" fill="#0759e8"/>
        <path d="M38 89 L35 94 Q32 99 46 97 L49 90 M62 90 L63 97 Q78 99 73 93 L70 89" fill="#ef233c"/>
        <path d="M38 60 Q54 52 70 60 L69 79 Q54 87 39 79 Z" fill="#0759e8"/>
        <path d="M42 57 H66 L63 75 L54 81 L45 75 Z" fill="#ef233c"/>
        <g class="sp-arm"><path d="M39 62 Q30 63 29 77 L36 80 L44 65" fill="#0759e8"/><path d="M29 74 Q22 85 31 87 Q39 86 36 77 Z" fill="#ef233c"/><path d="M26 81 L35 82 M30 76 L30 86" fill="none" stroke-width="1"/></g>
        <g class="sp-arm sp-right"><path d="M69 62 Q78 63 79 77 L72 80 L64 65" fill="#0759e8"/><path d="M79 74 Q86 85 77 87 Q69 86 72 77 Z" fill="#ef233c"/><path d="M73 82 L82 81 M78 76 L78 86" fill="none" stroke-width="1"/></g>
        <g fill="#171923" stroke-width="1.3"><ellipse cx="54" cy="69" rx="2.5" ry="4"/><circle cx="54" cy="64" r="1.8"/><path d="M52 66 L48 63 L47 60 M56 66 L60 63 L61 60 M52 68 L47 66 L45 64 M56 68 L61 66 L63 64 M52 70 L47 72 L46 75 M56 70 L61 72 L62 75 M52 72 L50 76 L50 78 M56 72 L58 76 L58 78" fill="none"/></g>
        <path d="M21 34 Q21 7 54 7 Q87 7 87 34 Q87 61 54 63 Q21 61 21 34 Z" fill="#f1263e" stroke-width="2.5"/>
        <path d="M54 8 V61 M54 30 L29 16 M54 30 L79 16 M54 30 L21 34 M54 30 L87 34 M54 30 L30 55 M54 30 L78 55 M38 10 Q39 21 31 25 Q29 34 24 43 M70 10 Q69 21 77 25 Q79 34 84 43 M27 20 Q40 30 54 18 Q68 30 81 20 M22 38 Q37 33 54 43 Q71 33 86 38 M29 53 Q41 45 54 54 Q67 45 79 53" fill="none" stroke-width="1.2" opacity=".85"/>
        <path class="sp-eye" d="M29 28 Q38 29 49 39 Q48 50 38 48 Q29 44 29 28 Z" fill="#fff" stroke-width="3"/>
        <path class="sp-eye" d="M79 28 Q70 29 59 39 Q60 50 70 48 Q79 44 79 28 Z" fill="#fff" stroke-width="3"/>
        <path class="sp-rest" d="M31 40 Q39 46 47 40 M61 40 Q69 46 77 40" fill="none" stroke="#fff" stroke-width="3"/>
        <g class="sp-device"><path d="M37 91 H71 L68 78 H40 Z" fill="#17202d"/><path d="M34 93 H74" stroke="#99dffb" stroke-width="3"/><path d="M45 82 L42 85 L45 88 M63 82 L66 85 L63 88" stroke="#99dffb" fill="none" stroke-width="1.5"/></g>
      </g>
    </svg>`;
  };
})();
