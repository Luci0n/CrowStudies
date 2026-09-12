/* Shared pieces of the handwriting screen, used by both the Chinese and the
   Japanese course.

   The stroke hint is drawn here rather than handed to the writing library.
   Its highlightStroke leaves the drawing untouched, during a quiz and outside
   one alike, so pressing the hint button did nothing at all. Character data is
   already on hand, so the hint is drawn straight from it: the shape of the
   stroke fades in, and a line travels along its centre in the direction the
   stroke is written. Direction is half of what a stroke hint is for. */
window.CrowStroke = (function(){
  'use strict';
  var SVG = 'http://www.w3.org/2000/svg';
  var pending = {};

  function characterData(url){
    if (!pending[url]) pending[url] = fetch(url).then(function(response){
      if (!response.ok) throw new Error('Character data unavailable');
      return response.json();
    });
    return pending[url];
  }

  /* Give the drawing a viewBox so it scales with its frame. The library sizes
     the tag in pixels, which pins the character at one size however wide the
     frame gets. */
  function fit(host, size){
    var svg = host.querySelector('svg');
    if (!svg || svg.dataset.fitted) return;
    svg.dataset.fitted = '1';
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
  }

  function line(points){
    return points.map(function(point, index){
      return (index ? 'L' : 'M') + point[0] + ' ' + point[1];
    }).join(' ');
  }

  function clear(host){
    var old = host.querySelector('.stroke-hint');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  /* Shows one stroke over the drawing. Resolves false when there is nothing to
     show, so the caller can say so rather than looking broken. */
  function showStroke(host, url, index){
    return characterData(url).then(function(data){
      var svg = host.querySelector('svg');
      var strokes = data && data.strokes;
      var medians = data && data.medians;
      if (!svg || !strokes || !strokes[index]) return false;

      /* Reuse the library's own transform so the hint lands exactly on the
         character, whatever size the frame is. */
      var placed = svg.querySelector('g[transform]');
      if (!placed) return false;

      clear(host);
      var layer = document.createElementNS(SVG, 'g');
      layer.setAttribute('class', 'stroke-hint');
      layer.setAttribute('transform', placed.getAttribute('transform'));
      svg.appendChild(layer);

      var shape = document.createElementNS(SVG, 'path');
      shape.setAttribute('class', 'stroke-hint-shape');
      shape.setAttribute('d', strokes[index]);
      layer.appendChild(shape);

      var path = medians && medians[index] && medians[index].length > 1
        ? medians[index] : null;
      if (path){
        var travel = document.createElementNS(SVG, 'path');
        travel.setAttribute('class', 'stroke-hint-travel');
        travel.setAttribute('d', line(path));
        layer.appendChild(travel);
        var length = travel.getTotalLength();
        travel.style.strokeDasharray = length;
        travel.style.strokeDashoffset = length;
        /* Committed before the transition, or the browser collapses the two
           into no change at all. */
        void travel.getBoundingClientRect();
        travel.style.transition = 'stroke-dashoffset .85s ease';
        travel.style.strokeDashoffset = '0';
      }

      setTimeout(function(){
        if (!layer.parentNode) return;
        layer.classList.add('is-leaving');
        setTimeout(function(){ if (layer.parentNode) layer.parentNode.removeChild(layer); }, 420);
      }, 1500);
      return true;
    }).catch(function(){ return false; });
  }

  return { showStroke: showStroke, clearHint: clear, fit: fit };
}());
