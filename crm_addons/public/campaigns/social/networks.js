/* The social networks the visual email builder offers: ONE list, used by the builder (browser) and by make_icons.js (node).
 *
 * To add a network:  1. add a line here (key = file name, label = what people see, svg = a file name in Bootstrap Icons, color = brand colour,
 * fg = glyph colour on the brand colour, default white)  2. run  node make_icons.js <bootstrap-icons folder>  to draw its three PNGs.
 * That is all: the builder's list, the icon files and the email output follow this list. (Anything not listed can be added by the user as
 * "Custom": their own icon image and name.) */
;(function (root) {
	var N = function (key, label, svg, color, fg) { return { key: key, label: label, svg: svg, color: color, fg: fg || '#ffffff' } }
	var list = [
		N('facebook', 'Facebook', 'facebook', '#1877f2'),
		N('instagram', 'Instagram', 'instagram', '#e1306c'),
		N('linkedin', 'LinkedIn', 'linkedin', '#0a66c2'),
		N('youtube', 'YouTube', 'youtube', '#ff0000'),
		N('x', 'X', 'twitter-x', '#111111'),
		N('whatsapp', 'WhatsApp', 'whatsapp', '#25d366'),
		N('telegram', 'Telegram', 'telegram', '#26a5e4'),
		N('tiktok', 'TikTok', 'tiktok', '#111111'),
		N('pinterest', 'Pinterest', 'pinterest', '#e60023'),
		N('threads', 'Threads', 'threads', '#111111'),
		N('snapchat', 'Snapchat', 'snapchat', '#fffc00', '#111111'),
		N('messenger', 'Messenger', 'messenger', '#0084ff'),
		N('signal', 'Signal', 'signal', '#3a76f0'),
		N('discord', 'Discord', 'discord', '#5865f2'),
		N('slack', 'Slack', 'slack', '#4a154b'),
		N('reddit', 'Reddit', 'reddit', '#ff4500'),
		N('medium', 'Medium', 'medium', '#111111'),
		N('substack', 'Substack', 'substack', '#ff6719'),
		N('quora', 'Quora', 'quora', '#b92b27'),
		N('github', 'GitHub', 'github', '#181717'),
		N('stackoverflow', 'Stack Overflow', 'stack-overflow', '#f48024'),
		N('behance', 'Behance', 'behance', '#1769ff'),
		N('dribbble', 'Dribbble', 'dribbble', '#ea4c89'),
		N('vimeo', 'Vimeo', 'vimeo', '#1ab7ea'),
		N('twitch', 'Twitch', 'twitch', '#9146ff'),
		N('spotify', 'Spotify', 'spotify', '#1db954'),
		N('mastodon', 'Mastodon', 'mastodon', '#6364ff'),
		N('bluesky', 'Bluesky', 'bluesky', '#1185fe'),
		N('skype', 'Skype', 'skype', '#00aff0'),
		N('line', 'LINE', 'line', '#06c755'),
		N('wechat', 'WeChat', 'wechat', '#07c160'),
		N('google', 'Google (reviews)', 'google', '#4285f4'),
		N('yelp', 'Yelp', 'yelp', '#d32323'),
		N('googleplay', 'Google Play', 'google-play', '#01875f'),
		N('appstore', 'App Store', 'apple', '#111111'),
		N('rss', 'Blog / RSS', 'rss', '#f26522'),
		N('phone', 'Phone', 'telephone', '#475569'),
		N('location', 'Location / map', 'geo-alt', '#ea4335'),
		N('website', 'Website', 'globe', '#475569'),
		N('email', 'Email', 'envelope', '#475569'),
	]
	if (typeof module !== 'undefined' && module.exports) module.exports = list
	else root.CM_SOCIAL = list
})(typeof window !== 'undefined' ? window : this)
