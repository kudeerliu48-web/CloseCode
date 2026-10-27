/* Procedural desktop actor; no settings thumbnail or external artwork. */
(function () {
  "use strict";
  window.petJudyMarkup = function () {
    const rabbit = `<g stroke="#424958" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <g class="ju-ear ju-ear-left"><path d="M61 67 C46 51 40 14 50 12 C62 9 70 46 68 65" fill="#a7adb7"/><path d="M60 56 C53 43 47 20 51 20 C57 20 63 45 63 57" fill="#efacc6" stroke="none"/></g>
      <g class="ju-ear ju-ear-right"><path d="M89 65 C87 44 95 9 105 13 C116 17 103 55 96 69" fill="#a7adb7"/><path d="M94 57 C94 43 101 20 104 21 C107 25 100 48 97 59" fill="#efacc6" stroke="none"/></g>
      <ellipse class="ju-tail" cx="103" cy="133" rx="7" ry="6" fill="#d1d5dc"/>
      <path d="M65 127 L61 143 Q65 150 74 145 L79 130 L85 145 Q96 150 99 143 L93 125" fill="#284f89"/>
      <path d="M61 139 Q52 147 62 150 H73 L75 141 M85 141 L86 150 H99 Q107 146 97 139" fill="#253448"/>
      <path d="M63 102 Q79 96 96 104 L97 129 Q80 137 61 129 Z" fill="#358ed1"/>
      <path d="M65 106 L74 111 L79 104 L85 111 L94 106 L93 130 H65 Z" fill="#245482"/>
      <path d="M78 108 L82 108 L84 121 L79 125 L76 121 Z" fill="#192e4a"/>
      <path d="M64 129 H96" stroke="#1d293c" stroke-width="5"/><rect x="77" y="127" width="7" height="5" rx="1" fill="#f6cf65" stroke-width="1"/>
      <path d="M88 111 l4 -2 4 2 -1 6 -3 2 -3 -2 Z" fill="#f4d270" stroke-width="1"/>
      <g class="ju-arm ju-left"><path d="M64 108 Q49 109 50 124 L61 128 L65 119" fill="#358ed1"/><ellipse cx="58" cy="127" rx="6" ry="5" fill="#b9bec7"/></g>
      <g class="ju-hip-hand"><path d="M63 108 Q52 107 43 120 Q43 124 48 125 L63 131 L66 125 L53 120 L63 117" fill="#358ed1"/><ellipse cx="64" cy="128" rx="5" ry="4" fill="#b9bec7"/></g>
      <g class="ju-arm ju-right"><path d="M95 108 Q109 113 108 125 L98 129 L94 119" fill="#358ed1"/><ellipse cx="101" cy="128" rx="6" ry="5" fill="#b9bec7"/></g>
      <g class="ju-head">
        <path d="M48 78 Q45 57 77 56 Q108 55 112 78 L116 88 L109 88 L114 94 L106 94 Q101 109 80 111 Q57 110 49 97 L42 96 L47 91 L41 90 Z" fill="#a7adb7"/>
        <path d="M54 93 Q64 86 80 96 Q97 86 106 93 Q101 108 80 109 Q60 109 54 93" fill="#e4e6eb" stroke="none"/>
        <g class="ju-eyes"><ellipse cx="65" cy="82" rx="9" ry="12" fill="#fafaff"/><ellipse cx="96" cy="82" rx="9" ry="12" fill="#fafaff"/>
        <ellipse cx="68" cy="84" rx="5" ry="8" fill="#9763c7"/><ellipse cx="93" cy="84" rx="5" ry="8" fill="#9763c7"/>
        <ellipse cx="69" cy="84" rx="2.6" ry="5.8" fill="#292438" stroke="none"/><ellipse cx="92" cy="84" rx="2.6" ry="5.8" fill="#292438" stroke="none"/>
        <circle cx="70" cy="80" r="2" fill="#fff" stroke="none"/><circle cx="94" cy="80" r="2" fill="#fff" stroke="none"/>
        <path d="M56 76 l-3 -2 M103 75 l4 -2" fill="none"/></g>
        <path class="ju-closed" d="M57 84 Q65 91 73 84 M87 84 Q95 91 103 84" fill="none" stroke-width="2.4"/>
        <path d="M75 94 Q80 91 85 94 L80 98 Z" fill="#d18fab" stroke-width="1"/>
        <g class="ju-mouth"><path d="M73 100 Q80 107 87 100" fill="#79556c"/><path d="M78 100 H83 V104 H78 Z" fill="#fff" stroke-width=".7"/></g>
        <path d="M52 93 l9 2 M100 95 l9 -2" stroke="#838b99" stroke-width="1"/>
        <path d="M61 62 Q80 48 101 62 L99 69 Q78 73 60 67 Z" fill="#307cbc"/>
        <path d="M64 68 Q80 63 97 68 Q87 76 68 72 Z" fill="#253c64"/>
        <path d="M77 58 L82 57 L85 61 L81 66 L77 63 Z" fill="#f6d276" stroke-width="1"/>
      </g>
      <g class="ju-snack-hand"><path d="M98 112 Q112 107 103 97 L96 103" fill="#358ed1"/>
        <g class="ju-carrot"><path d="M85 98 Q88 104 91 99 Q94 106 97 102 L105 112 Q101 120 94 116 Z" fill="#ff9940"/><path d="M85 98 Q88 104 91 99 Q94 106 97 102" fill="none" stroke="#ffe1a5" stroke-width="2"/>
        <path d="M95 112 Q101 120 101 125 M95 112 Q91 121 94 125 M95 113 L104 117" fill="none" stroke="#4d9a57" stroke-width="3"/>
        <path d="M88 100 L92 101 M92 106 L96 107" stroke="#cb642b" stroke-width="1"/></g>
        <ellipse cx="100" cy="108" rx="6" ry="4.5" fill="#b9bec7"/>
      </g>
      <g class="ju-badge-hand"><path d="M97 114 Q110 124 120 112 L126 102" fill="none" stroke="#358ed1" stroke-width="9"/>
        <rect class="ju-credential" x="107" y="75" width="24" height="31" rx="3" fill="#243349" stroke="#172334"/>
        <rect x="110" y="78" width="18" height="25" rx="1" fill="#eee9d8" stroke="none"/>
        <path d="M115 82 l4 -2 5 2 -1 7 -4 3 -4 -3 Z" fill="#e8bb4d" stroke="#aa7f26" stroke-width="1"/>
        <path d="M114 96 H124 M114 99 H121" stroke="#34547b" stroke-width="1.4"/>
        <ellipse cx="125" cy="104" rx="5" ry="4" fill="#b9bec7"/>
      </g>
    </g>`;
    return `<svg id="judy" class="actor" viewBox="0 0 160 160" role="img" aria-label="Q版兔朱迪，兔子警官">
      <style>
        #judy { display:none;animation:none;filter:drop-shadow(0 2px 2px #29334730); }
        .c-judy #judy { display:block; }
        .c-judy #cat,.c-judy #photo { display:none; }
        .c-judy #stage { width:min(132px,90vw);height:auto;aspect-ratio:132/142;flex-shrink:0; }
        .c-judy #judy { width:100%;height:auto;aspect-ratio:1; }
        .c-judy #fx { left:0;top:16px;width:100%; }
        .c-judy #spin,.c-judy #halo,.c-judy #shadow { display:none; }
        .c-judy #qmark { left:4px;top:20px; }
        .c-judy #sparks { left:8px;top:20px; }
        .c-judy #zzz { left:80px;top:48px; }
        .c-judy #drop { right:18px;top:67px; }
        .c-judy #bubble { z-index:2;max-height:42px;overflow:auto;flex-shrink:1; }
        .ju-ear-left { transform-origin:64px 64px;animation:ju-ear-a 2.7s ease-in-out infinite; }
        .ju-ear-right { transform-origin:94px 65px;animation:ju-ear-b 3.3s ease-in-out infinite; }
        .ju-left { transform-origin:64px 109px; }
        .ju-right { transform-origin:95px 109px; }
        .ju-closed,.ju-snack-hand,.ju-badge-hand,.ju-rest { display:none; }
        .ju-mouth { transform-origin:80px 101px; }
        .s-idle .ju-upright,.s-sleep .ju-upright { display:none; }
        .s-idle .ju-rest,.s-sleep .ju-rest { display:block; }
        .ju-rest .ju-eyes,.ju-rest .ju-mouth { display:none; }
        .ju-rest .ju-left { transform:rotate(-65deg); }
        .ju-rest .ju-right { transform:rotate(40deg); }
        .ju-rest .ju-closed { display:block; }
        .ju-rest-body { transform-origin:80px 137px;animation:ju-breath 3.8s ease-in-out infinite; }
        .ju-rest .ju-ear { animation-duration:5.7s; }
        .s-working .ju-upright .ju-right { display:none; }
        .s-working .ju-snack-hand { display:block;animation:ju-nibble .7s ease-in-out infinite; }
        .s-working .ju-mouth { animation:ju-chew .35s ease-in-out infinite; }
        .s-done .ju-upright .ju-right { display:none; }
        .s-done .ju-badge-hand { display:block;transform-origin:97px 110px;animation:ju-proud 1.9s ease-in-out infinite; }
        .ju-hip-hand { display:none; }
        .s-done .ju-upright .ju-left { display:none; }
        .s-done .ju-upright .ju-hip-hand { display:block; }
        .ju-rest .ju-ear-left { transform-origin:47px 119px;animation:ju-rest-ear 5.7s ease-in-out infinite; }
        .ju-rest .ju-ear-right { transform-origin:48px 123px;animation:ju-rest-ear 6.3s ease-in-out infinite reverse; }
        @keyframes ju-rest-ear { 0%,100%{transform:rotate(-1deg)}50%{transform:rotate(2deg)} }
        .s-asking .ju-right { animation:ju-wave .65s ease-in-out infinite alternate; }
        .s-asking .ju-upright { animation:ju-attention 1.3s ease-in-out infinite; }
        .s-error .ju-right { transform:rotate(150deg); }
        .s-error .ju-head { transform-origin:80px 104px;animation:ju-worry 1.4s ease-in-out infinite; }
        .s-error .ju-ear-left { animation-name:ju-droop; }
        .blinking .ju-upright .ju-eyes { opacity:0; }
        .blinking .ju-upright .ju-closed { display:block; }
        @keyframes ju-ear-a { 0%,100%{transform:rotate(-5deg)}50%{transform:rotate(7deg)} }
        @keyframes ju-ear-b { 0%,100%{transform:rotate(6deg)}50%{transform:rotate(-7deg)} }
        @keyframes ju-breath { 0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.035) translateY(-1px)} }
        @keyframes ju-nibble { 0%,100%{transform:translate(0,0)}50%{transform:translate(-6px,-4px)} }
        @keyframes ju-chew { 0%,100%{transform:scale(1,1)}50%{transform:scale(1.16,.58)} }
        @keyframes ju-proud { 0%,100%{transform:rotate(-3deg)}50%{transform:rotate(4deg) translateY(-2px)} }
        @keyframes ju-wave { from{transform:rotate(120deg)}to{transform:rotate(155deg)} }
        @keyframes ju-attention { 0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)} }
        @keyframes ju-worry { 0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)} }
        @keyframes ju-droop { 0%,100%{transform:rotate(-17deg)}50%{transform:rotate(-25deg)} }
        @media(prefers-reduced-motion:reduce) {
          #judy,#judy * { animation:none!important;transition:none!important; }
          .blinking .ju-upright .ju-eyes { opacity:1; }
          .blinking .ju-upright .ju-closed { display:none; }
          .s-asking .ju-right { transform:rotate(135deg); }
        }
      </style>
      <g class="ju-rest">
        <ellipse cx="80" cy="145" rx="70" ry="10" fill="#82be72"/>
        <ellipse cx="83" cy="142" rx="53" ry="5" fill="#47774e" opacity=".3"/>
        <path d="M17 147 l-4 -8 8 6 2 -10 5 11 M115 148 l3 -11 4 8 8 -9 -3 11 M42 151 l3 -7 4 7 M139 145 l5 -9 1 10" fill="#4a9257"/>
        <g class="ju-rest-body" stroke="#424958" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <ellipse cx="128" cy="129" rx="9" ry="8" fill="#d1d5dc"/>
          <path d="M91 117 Q111 111 125 121 Q136 132 119 141 L99 142 L91 135 L115 132 L104 128 Z" fill="#284f89"/>
          <path d="M100 136 Q113 132 123 139 L133 140 Q140 147 128 147 L108 146 Z" fill="#253448"/>
          <path d="M89 131 Q96 135 91 141 L75 145 Q66 144 73 138 Z" fill="#253448"/>
          <path d="M62 114 Q83 104 104 118 L104 135 Q86 145 65 134 Z" fill="#358ed1"/>
          <path d="M75 114 Q88 111 101 118 L98 135 L81 139 Z" fill="#245482"/>
          <path d="M99 117 L102 135" stroke="#1d293c" stroke-width="5"/>
          <path d="M73 128 Q83 134 93 134 L87 140 L65 137" fill="#358ed1"/>
          <ellipse cx="65" cy="136" rx="10" ry="5" fill="#b9bec7"/>
          <g class="ju-ear ju-ear-left"><path d="M51 121 Q29 113 12 128 Q10 134 20 134 L53 129 Z" fill="#a7adb7"/><path d="M43 123 Q26 121 18 129 L42 127" fill="#efacc6" stroke="none"/></g>
          <g class="ju-ear ju-ear-right"><path d="M53 126 Q28 126 17 138 Q17 144 29 141 L58 134 Z" fill="#a7adb7"/><path d="M46 130 L24 138 L50 133" fill="#efacc6" stroke="none"/></g>
          <path d="M49 127 Q41 136 53 140 L69 140 L72 134 L58 131" fill="#358ed1"/>
          <path d="M42 133 Q36 128 32 132 Q29 138 38 141 L59 141 Q65 138 60 134 Z" fill="#b9bec7"/>
          <path d="M37 134 L41 137 M43 133 L47 137" fill="none" stroke-width="1"/>
          <path d="M113 122 Q123 125 119 131 L105 137" fill="none" stroke="#172f53"/>
          <path d="M109 147 L132 147" stroke="#47774e" stroke-width="2"/>
          <g class="ju-head" transform="translate(3 64) rotate(-16 54 55) scale(.72)">
            <path d="M48 78 Q45 57 77 56 Q108 55 112 78 L116 88 L109 88 L114 94 L106 94 Q101 109 80 111 Q57 110 49 97 L42 96 L47 91 L41 90 Z" fill="#a7adb7"/>
            <path d="M54 93 Q64 86 80 96 Q97 86 106 93 Q101 108 80 109 Q60 109 54 93" fill="#e4e6eb" stroke="none"/>
            <path class="ju-closed" d="M57 84 Q65 90 73 84 M87 84 Q95 90 103 84" fill="none" stroke-width="2.4"/>
            <path d="M76 94 Q80 91 84 94 L80 98 Z" fill="#d18fab"/>
            <path d="M76 101 Q81 104 86 100" fill="none"/>
            <path d="M61 62 Q80 48 101 62 L99 69 Q78 73 60 67 Z" fill="#307cbc"/>
            <path d="M64 68 Q80 63 97 68 Q87 76 68 72 Z" fill="#253c64"/>
            <path d="M77 58 L82 57 L85 61 L81 66 L77 63 Z" fill="#f6d276"/>
          </g>
        </g>
      </g>
      <g class="ju-upright">${rabbit}</g>
    </svg>`;
  };
})();
