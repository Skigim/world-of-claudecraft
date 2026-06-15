<?php
if ( !defined( 'MEDIAWIKI' ) ) {
	exit;
}

$wgSitename = 'World of Claudecraft Wiki';
$wgMetaNamespace = 'World_of_Claudecraft';
$wgScriptPath = '/wiki';
// Origin the wiki is browsed on. An explicit MEDIAWIKI_SERVER wins (set it in
// production for safety); otherwise derive it from the reverse proxy's
// forwarded headers — the game server sets these — falling back to the request
// Host so direct access and the Vite dev origin both work without config.
$mwServer = getenv( 'MEDIAWIKI_SERVER' );
if ( !$mwServer ) {
	$mwProto = $_SERVER['HTTP_X_FORWARDED_PROTO']
		?? ( ( ( $_SERVER['HTTPS'] ?? '' ) === 'on' ) ? 'https' : 'http' );
	$mwHost = $_SERVER['HTTP_X_FORWARDED_HOST']
		?? ( $_SERVER['HTTP_HOST'] ?? 'localhost:8080' );
	$mwServer = $mwProto . '://' . $mwHost;
}
$wgServer = $mwServer;
$wgArticlePath = "$wgScriptPath/index.php/$1";
$wgUsePathInfo = true;
$wgResourceBasePath = $wgScriptPath;

$wgLogos = [
	'1x' => "$wgScriptPath/resources/assets/woc-logo-square.webp",
	'icon' => "$wgScriptPath/resources/assets/woc-logo-square.webp",
];

$wgEnableEmail = false;
$wgEnableUserEmail = false;

$wgDBtype = 'mysql';
$wgDBserver = getenv( 'MEDIAWIKI_DB_HOST' ) ?: 'mediawiki-db';
$wgDBname = getenv( 'MEDIAWIKI_DB_NAME' ) ?: 'mediawiki';
$wgDBuser = getenv( 'MEDIAWIKI_DB_USER' ) ?: 'mediawiki';
$wgDBpassword = getenv( 'MEDIAWIKI_DB_PASSWORD' ) ?: 'mediawiki';
$wgDBprefix = '';
$wgDBTableOptions = 'ENGINE=InnoDB, DEFAULT CHARSET=binary';

$wgMainCacheType = CACHE_ACCEL;
$wgMemCachedServers = [];

$wgSecretKey = getenv( 'MEDIAWIKI_SECRET_KEY' ) ?: 'local-dev-change-me-world-of-claudecraft';
$wgAuthenticationTokenVersion = '1';
$wgUpgradeKey = getenv( 'MEDIAWIKI_UPGRADE_KEY' ) ?: 'local-dev-upgrade-key';

$wgLanguageCode = 'en';
$wgLocaltimezone = 'UTC';
$wgEmergencyContact = 'admin@localhost';
$wgPasswordSender = 'admin@localhost';

$wgEnableUploads = true;
$wgUseImageMagick = false;
$wgImageMagickConvertCommand = '/usr/bin/convert';

$wgDefaultSkin = 'vector-2022';
$wgVectorDefaultSkinVersion = '2';

$wgGroupPermissions['*']['edit'] = false;
$wgGroupPermissions['*']['createaccount'] = false;
$wgGroupPermissions['user']['edit'] = true;

$wgDefaultUserOptions['usebetatoolbar'] = 1;
$wgDefaultUserOptions['usenewrc'] = 1;
$wgDefaultUserOptions['vector-theme'] = 'os';
$wgDefaultUserOptions['vector-toc-pinned'] = 1;
$wgDefaultUserOptions['vector-page-tools-pinned'] = 1;

$wgAllowSiteCSSOnRestrictedPages = true;
$wgRawHtml = false;

wfLoadSkin( 'Vector' );

$wgHooks['BeforePageDisplay'][] = static function ( OutputPage $out, Skin $skin ): void {
	$out->addStyle( '/wiki/resources/assets/woc-mediawiki.css' );
};
