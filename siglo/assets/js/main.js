$(function() {
  var scrollchk = 0;
  $('#fullpage').fullpage({
    // 옵션
    scrollingSpeed: 1000,
    menu: '#nav',
    navigation: true,
    navigationPosition: 'right',
    showActiveTooltip: false,
    responsiveWidth: 990,
    paddingTop: 0,
    onLeave: function(anchorLink, index){
      if(index === 2){
        $('.section').removeClass('active');
        $('.section-info').addClass('active');
      }
    },
    afterLoad: function(anchorLink, index) {
      $('.fp-nav-number-current').text('0'+ index)
      $('.premium-list').removeClass('show')
      $('.customer-content-area').removeClass('show')
      $('.right-content').removeClass('last')
      if (index === 1) {
        $('.js-header').removeClass('white')
      }
      if (index === 2) {
        $('.js-header').addClass('white')
        $('.js-nav').click();
        $('.section-info .section-info-text1').addClass("ani");
        $('.section-info').addClass('active');
        $('.section-info').on('mousewheel', function(event,delta){

          event.stopPropagation()
          if(scrollchk === 0) {
            if (delta > 0) { //마우스 휠을 올렸을때
              $.fn.fullpage.setAllowScrolling(true, 'up');
            }else if (delta < 0) {  //마우스 휠을 내렸을때
              $.fn.fullpage.setAllowScrolling(false, 'down');
              $('.section-info-text2').css("top","0");
              scrollchk = 1;
              schk2 = 0;
            }
          }else {
            if (delta > 0) { //마우스 휠을 올렸을때
              $.fn.fullpage.setAllowScrolling(false, 'up');
              $('.section-info-text2').css("top","100%");
              scrollchk = 0;
            }else if (delta < 0) {  //마우스 휠을 내렸을때
            }
          }
          $('.section-info-text1').on("mousewheel",function(event,delta){
            if (delta > 0) { //마우스 휠을 올렸을때
              $.fn.fullpage.moveTo(1);
            }else if (delta < 0) {  //마우스 휠을 내렸을때
            }
          });
          $('.section-info-text2').on("mousewheel",function(event,delta){
            if (delta > 0) { //마우스 휠을 올렸을때
            }else if (delta < 0) {  //마우스 휠을 내렸을때
              $.fn.fullpage.moveTo(3);
            }
          });
        });

        $('.section-info-text1').on('touchstart',function(event){
          startY = event.originalEvent.changedTouches[0].screenY;
          $.fn.fullpage.setAllowScrolling(false, 'down');
          $.fn.fullpage.setAllowScrolling(true, 'up');
        });
        $('.section-info-text1').on('touchend',function(event){
          endY = event.originalEvent.changedTouches[0].screenY;

          if(startY - endY > 20){
            $('.section-info-text2').css('top','0');
          }else{
            $('.section-info-text2').css('top','100%');
          }
        });
        $('.section-info-text2').on('touchstart',function(event){
          startY = event.originalEvent.changedTouches[0].screenY;
          $.fn.fullpage.setAllowScrolling(false, 'up');
        });
        $('.section-info-text2').on('touchend', function(event){
          endY = event.originalEvent.changedTouches[0].screenY;
          if(startY - endY > 20){
            $.fn.fullpage.moveTo(3);
          }else{
            $('.section-info-text2').css('top','100%');
          }
        });

      } else{
        $.fn.fullpage.setAllowScrolling(true);
      }
      if (index === 3 ) {
        $('.premium-list').addClass('show')
      }
      if (index === 4 ) {
        $('.customer-content-area').addClass('show')
      }
      if (index === 5 ) {
        $('.customer-content-area').addClass('show')
        $('.right-content').addClass('last')
      }
			else {
			}
      if (index === 3 || index === 4 || index === 5) {
        $('.js-header').addClass('white')
      }
    }
  });

  var mainVisual = new Swiper('.main-visual', {
    paginationClickable: true,
    pagination: { el: '.main-visual .swiper-pagination.progress', type: 'progressbar', clickable: !1 },
    autoplay: { delay: 5000, disableOnInteraction: !1 },
    navigation: { nextEl: '.main-visual .swiper-button-next', prevEl: '.main-visual .swiper-button-prev' },
    effect: 'fade',
    on: {
      init: function () {
        $('.js-visual-pagination .visual-pagination__item:first-child').addClass('is--active');
      },
      slideChange: function () {
        var currentNumber = this.realIndex
        $('.js-visual-pagination .visual-pagination__item').removeClass('is--active')
        $('.js-visual-pagination .visual-pagination__item').eq(currentNumber).addClass('is--active')
      }
    }
  });

  $('#fp-nav').prepend('<span class="fp-nav-number fp-nav-number-current">01</span>')
  $('#fp-nav').append('<span class="fp-nav-number fp-nav-number-total">04</span>')

  var sectionLength = $('#fullpage .section:not(.fp-auto-height)').length
  $('.fp-nav-number-total').text('0'+ sectionLength)

  $('.visual-pagination__item').on('click', function (){
    var index = $(this).data('paging-index')
    mainVisual.slideTo(index)
  })

  var info = new Swiper('.info-list', {
    paginationClickable: true,
    effect: 'fade',
    slidesPerView : 1,
    spaceBetween : 0,
    loop : true,
    allowTouchMove: false,
    navigation: { nextEl: '.swiper-button--next', prevEl: '.swiper-button--prev' },
    on: {
      init: function () {
        $('.info-thumb-item').eq(0).addClass('active')
        $('.info-thumb-item').eq(1).addClass('active-prev')
        $('.info-thumb-item').eq(2).addClass('active-prev')
      },
      slideChange: function () {
        var currentNumber = this.realIndex
        $('.info-thumb-item').siblings().removeClass('active').addClass('active-prev').eq(currentNumber).addClass('active').removeClass('active-prev')
      }
    }
  });

  AOS.init({
    duration: 1000
  });
})
