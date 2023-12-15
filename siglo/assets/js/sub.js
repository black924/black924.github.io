var gallerySlide = function () {
	var $slick_gallery_ele = $('.gallery-slide')
	var $slick_nav_ele = $('.gallery-slide-nav')

	$slick_gallery_ele.slick({
		slidesToShow: 1,
		slidesToScroll: 1,
		fade: true,
		arrows: false,
		autoplay: true,
		autoplaySpeed: 4000,
		asNavFor: '.gallery-slide-nav',
		draggable: true
	});

	$slick_nav_ele.slick({
		slidesToScroll: 1,
		asNavFor: '.gallery-slide',
		arrows: true,
		autoplay: true,
		autoplaySpeed: 4000,
		variableWidth: true,
		focusOnSelect: true
	});
}

$(function () {
	gallerySlide()

	$('.sub-top__description').addClass('is--active');
	AOS.init({
		duration: 1000
	});



	$('ul.tabs li').click(function () {
		var tab_area_id = $(this).attr('data-tab');
		$('ul.tabs li').removeClass('current');
		$('.tab-area').removeClass('current');
		$(this).addClass('current');
		$("#" + tab_area_id).addClass('current');
	});

	$('ul.tabs2 li').click(function () {
		var tab_id = $(this).attr('data-tab');
		$('ul.tabs2 li').removeClass('current');
		$('.tab-content').removeClass('current');
		$(this).addClass('current');
		$("#" + tab_id).addClass('current');
	});


	$('.vr-link84b').click(function (e) {
		location.href = '/siglo/household/e_modelhouse.html';
		e.stopImmediatePropagation();
	});
	$('.vr-link84c').click(function (e) {
		location.href = '/siglo/household/e_modelhouse2.html';
		e.stopImmediatePropagation();
	});

	$('.display-link84b').click(function (e) {
		location.href = '/siglo/household/display.html?n=1';
		e.stopImmediatePropagation();
	});
	$('.display-link84c').click(function (e) {
		location.href = '/siglo/household/display.html?n=2';
		e.stopImmediatePropagation();
	});

	$('.element-link84a').click(function (e) {
		location.href = '/siglo/household/element.html?n=2';
		e.stopImmediatePropagation();
	});
	$('.element-link84b').click(function (e) {
		location.href = '/siglo/household/element.html?n=3';
		e.stopImmediatePropagation();
	});
	$('.element-link84c').click(function (e) {
		location.href = '/siglo/household/element.html?n=4';
		e.stopImmediatePropagation();
	});
	$('.element-link84d').click(function (e) {
		location.href = '/siglo/household/element.html?n=5';
		e.stopImmediatePropagation();
	});

	$('.vr-link39ob').click(function (e) {
		alert('준비중입니다.');
		e.stopImmediatePropagation();
		//window.location.href = '/media/e_modelhouse2.html'; 
	});
	$('.vr-link39oa').click(function (e) {
		alert('준비중입니다.');
		e.stopImmediatePropagation();
		//window.location.href = '/media/e_modelhouse3.html';
	});
	$('.vr-link39oa-t').click(function (e) {
		alert('준비중입니다.');
		e.stopImmediatePropagation();
		//window.location.href = '/media/e_modelhouse3.html';
	});

	$('.display-link39ob').click(function (e) {
		alert('준비중입니다.');
		e.stopImmediatePropagation();
		//window.location.href = '/household/display.html'; 
	});
	$('.display-link39oa').click(function (e) {
		alert('준비중입니다.');
		e.stopImmediatePropagation();
		//window.location.href = '/household/display.html';
	});
	$('.display-link39oa-t').click(function (e) {
		alert('준비중입니다.');
		e.stopImmediatePropagation();
		//window.location.href = '/household/display.html';
	});

	$('.element-link39ob-t').click(function (e) {
		location.href = '/siglo/household/element.html';
		e.stopImmediatePropagation();
	});
	$('.element-link39ob').click(function (e) {
		location.href = '/siglo/household/element.html';
		e.stopImmediatePropagation();
	});
	$('.element-link39oa').click(function (e) {
		location.href = '/siglo/household/element.html';
		e.stopImmediatePropagation();
	});
	$('.element-link39oa-t').click(function (e) {
		location.href = '/siglo/household/element.html';
		e.stopImmediatePropagation();
	});

	$('ul.unit-tab li').click(function () {
		var tab_id = $(this).attr('data-tab');
		$('ul.unit-tab li').removeClass('current');
		$('.tab-content').removeClass('current');
		$(this).addClass('current');
		$("#" + tab_id).addClass('current');
	});
})
