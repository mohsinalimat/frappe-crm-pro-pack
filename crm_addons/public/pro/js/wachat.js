/* Suite Pro: the WhatsApp chat, shaped like the app. The lead page and the inbox both use it, so they look and behave the same.
   The 24-hour rule of the WhatsApp Business platform decides between free text and a template. */
(() => {
	const { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const day = (s) => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) + (String(s).length > 10 ? ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '') }
	const clock = (s) => { const d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
	const dayKey = (s) => String(s || '').slice(0, 10)
	const dayLabel = (s) => { const d = new Date(dayKey(s) + 'T00:00:00'); if (isNaN(d)) return ''; const t = new Date(); t.setHours(0, 0, 0, 0); const diff = Math.round((t - d) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' }) }
	const EMOJI = {
		'😀': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤔', '🤐', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬'],
		'👍': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '🙏', '👏', '🙌', '👐', '🤲', '💪', '✍️', '🤳', '👀', '👁️', '🧠', '🗣️', '👤', '👥'],
		'❤️': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💯', '💢', '💥', '💫', '💦', '💤', '✨', '⭐', '🌟', '🔥', '🎉', '🎊', '🎁', '🏆', '🥇', '🎯', '✅', '❌', '⚠️', '❓', '❗', '➕', '➖', '➡️', '⬅️', '⬆️', '⬇️', '🔔', '🔒', '🔑'],
		'💼': ['💼', '📁', '📂', '📄', '📃', '📋', '📌', '📍', '📎', '🖇️', '📝', '✏️', '🖊️', '📅', '📆', '🗓️', '⏰', '⏳', '⌛', '📞', '☎️', '📱', '💻', '🖥️', '📧', '✉️', '📨', '📩', '📤', '📥', '📦', '💰', '💵', '💳', '🧾', '📈', '📉', '📊', '🔍', '💡', '🔗', '🏢', '🏠', '🏭', '🛒'],
		'🍕': ['☕', '🍵', '🍺', '🍷', '🥂', '🍕', '🍔', '🍟', '🌮', '🍝', '🍣', '🍰', '🎂', '🍫', '🍎', '🍌', '🍇', '🍉', '🥗', '🌞', '🌙', '⛅', '🌧️', '🌈', '🌸', '🌹', '🌻', '🌳', '🐶', '🐱', '🐼', '🦁'],
		'🚗': ['🚗', '🚕', '🚌', '🚆', '✈️', '🚀', '🚲', '🏍️', '⛽', '🗺️', '🧭', '🏖️', '🏔️', '🌆', '🌍', '⚽', '🏏', '🏀', '🎮', '🎵', '🎬', '📷'],
	}
	const EMOJI_TABS = Object.keys(EMOJI)

	/** Props: the messages and what the person may do. ``send({ text, attach, type, replyTo })``, ``react(message, emoji)`` and ``render(text)``
	    are the page's own calls (a lead and an inbox chat are different records); a rejected promise shows its message. */
	V.WaChat = {
		props: { messages: { type: Array, default: () => [] }, windowOpen: Boolean, windowUntil: String, canWrite: Boolean, canTemplate: Boolean, title: String, image: String, subtitle: String, hasNumber: { type: Boolean, default: true }, noNumberText: String, person: { type: String, default: 'Lead' }, send: Function, react: Function, render: Function },
		emits: ['template'],
		setup(props, { emit }) {
			const wa = reactive({ text: '', busy: false, emoji: false, cat: '😀', menu: false, replies: [], hi: 0, reply: null, pending: null, menuFor: '' }); const chat = ref(null); const pics = ref(null); const vids = ref(null); const docs = ref(null)
			const waMessages = computed(() => [...(props.messages || [])].sort((a, b) => String(a.creation).localeCompare(String(b.creation))))
			const waDays = computed(() => { const out = []; for (const m of waMessages.value) { const k = dayKey(m.creation); const last = out[out.length - 1]; if (last && last.key === k) last.items.push(m); else out.push({ key: k, label: dayLabel(m.creation), items: [m] }) } return out })
			const toEnd = () => nextTick(() => { if (chat.value) chat.value.scrollTop = chat.value.scrollHeight })
			watch(() => props.messages, toEnd); onMounted(toEnd)
			// saved replies: type / in the box and pick one
			async function loadReplies() { try { const r = await CM.call('crm_addons.pro.config.get_whatsapp_replies', {}); wa.replies = r.replies } catch (e) { /* the box works without them */ } }
			onMounted(loadReplies)
			const slash = computed(() => { if (!wa.text.startsWith('/')) return []; const q = wa.text.slice(1).toLowerCase(); return wa.replies.filter((r) => (r.title + ' ' + r.text).toLowerCase().includes(q)).slice(0, 8) })
			watch(slash, () => { wa.hi = 0 })
			// the reply is filled in for this person by the page that owns the chat and only put in the box: the person reads and edits it, then sends
			async function useReply(r) {
				wa.menu = false; wa.text = r.text; wa.pending = r.attach_url ? { url: r.attach_url, name: r.attach_name, type: r.attach_type || 'document' } : null
				if (props.render) { try { wa.text = await props.render(r.text) } catch (e) { /* the raw text stays for editing */ } }
				nextTick(() => { const el = document.querySelector('.wx-in'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } })
			}
			function onKeys(e) {
				if (!slash.value.length) return
				if (e.key === 'ArrowDown') { e.preventDefault(); wa.hi = Math.min(slash.value.length - 1, wa.hi + 1) } else if (e.key === 'ArrowUp') { e.preventDefault(); wa.hi = Math.max(0, wa.hi - 1) }
				else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); useReply(slash.value[wa.hi]) } else if (e.key === 'Escape') wa.text = ''
			}
			const grouped = (d, i) => i > 0 && d.items[i - 1].type === d.items[i].type
			const mediaOf = (m) => { const a = m.attach; if (!a) return ''; const t = m.content_type; if (t === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(a)) return 'image'; if (t === 'video' || /\.(mp4|3gp|mov)$/i.test(a)) return 'video'; if (t === 'audio' || /\.(mp3|ogg|opus|m4a|aac|amr)$/i.test(a)) return 'audio'; return 'document' }
			const fileName = (u) => decodeURIComponent(String(u || '').split('/').pop().split('?')[0])
			const caption = (m) => (m.message && m.message !== m.attach ? m.message : '')
			const bubbleText = (m) => caption(m) || (!m.attach ? (m.template_name ? (m.template || '') : (m.message || (m.template ? m.template : '[' + (m.content_type || 'message') + ']'))) : '')
			const tick = (m) => { const st = String(m.status || '').toLowerCase(); return st === 'read' ? 'read' : st === 'delivered' ? 'delivered' : st === 'failed' ? 'failed' : 'sent' }
			const REACTS = ['👍', '❤️', '😂', '😮', '😢', '🙏']
			function startReply(m) { wa.reply = m; wa.menuFor = ''; nextTick(() => { const el = document.querySelector('.wx-in'); if (el) el.focus() }) }
			async function copyText(m) { wa.menuFor = ''; try { await navigator.clipboard.writeText(bubbleText(m) || m.message || ''); CM.toast('Copied') } catch (e) { CM.toast('Could not copy', 'err') } }
			async function react(m, x) { wa.menuFor = ''; try { await props.react(m, m.reaction === x ? '' : x) } catch (e) { CM.toast(e.message, 'err') } }
			async function sendWa(file) {
				wa.busy = true
				try {
					let attachUrl = ''; let type = 'text'
					if (file) { const up = await CM.upload(file, { isPrivate: false }); attachUrl = up.file_url; type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'document' }
					else if (wa.pending) { attachUrl = wa.pending.url; type = wa.pending.type }
					await props.send({ text: wa.text, attach: attachUrl, type, replyTo: wa.reply ? wa.reply.name : '' }); wa.text = ''; wa.emoji = false; wa.reply = null; wa.pending = null
				} catch (e) { CM.toast(e.message, 'err') } finally { wa.busy = false }
			}
			function pickFile(e) { wa.menu = false; const f = e.target.files[0]; e.target.value = ''; if (f) sendWa(f) }
			const addEmoji = (x) => { wa.text += x }
			const shortTime = (s) => { const d = new Date(String(s || '').replace(' ', 'T')); if (isNaN(d)) return ''; const t = new Date(); const sameDay = d.toDateString() === t.toDateString(); return (sameDay ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ') + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
			function closeChatPops(e) { if (!wa.emoji && !wa.menu && !wa.menuFor) return; if (e.target.closest && e.target.closest('.wx-emoji, .wx-attach, .wx-menu, .wx-more, .wx-ib')) return; wa.emoji = false; wa.menu = false; wa.menuFor = '' }
			onMounted(() => document.addEventListener('click', closeChatPops)); onBeforeUnmount(() => document.removeEventListener('click', closeChatPops))
			return { wa, chat, pics, vids, docs, waDays, waMessages, slash, useReply, onKeys, grouped, mediaOf, fileName, bubbleText, tick, REACTS, startReply, copyText, react, sendWa, pickFile, addEmoji, shortTime, EMOJI, EMOJI_TABS, clock, day }
		},
		template: `
								<div class="wx">
									<div class="wx-head"><Pic :name="title" :image="image" :size="30" /><div class="grow"><b>{{ title }}</b><div class="small">{{ subtitle || 'No phone number' }}</div></div><slot name="head" />
										<span class="wx-win" :class="{ on: windowOpen }" :title="windowOpen ? 'Free chat is open until ' + day(windowUntil) : 'They have not written in 24 hours'">{{ windowOpen ? 'Open till ' + shortTime(windowUntil) : 'Template needed' }}</span>
										<button v-if="canTemplate && hasNumber" type="button" class="wx-tpl" @click="$emit('template')"><Ico name="send" size="sm" /> Template</button></div>
									<div ref="chat" class="wx-chat" @click="wa.menuFor = ''"><p v-if="!waMessages.length" class="wx-note">No messages yet. Start with a template.</p>
										<template v-for="d in waDays" :key="d.key"><div class="wx-day"><span>{{ d.label }}</span></div>
											<div v-for="(m, mi) in d.items" :key="m.name" class="wx-row" :class="[m.type === 'Incoming' ? 'in' : 'out', grouped(d, mi) ? 'cont' : 'first']"><div class="wx-bub" :class="{ reacted: m.reaction }">
												<button v-if="canWrite && windowOpen" type="button" class="wx-more" aria-label="Message options" @click.stop="wa.menuFor = wa.menuFor === m.name ? '' : m.name"><Ico name="chevron-down" size="sm" /></button>
												<div v-if="wa.menuFor === m.name" class="wx-menu" @click.stop><div class="wx-react"><button v-for="x in REACTS" :key="x" type="button" :class="{ on: m.reaction === x }" :aria-label="'React ' + x" @click="react(m, x)">{{ x }}</button></div><button type="button" @click="startReply(m)"><Ico name="arrow-left" size="sm" /> Reply</button><button type="button" @click="copyText(m)"><Ico name="copy" size="sm" /> Copy</button></div>
												<div v-if="m.is_reply && m.reply_message" class="wx-quote"><b>{{ m.reply_to_from || 'Message' }}</b><span>{{ m.reply_message }}</span></div>
												<template v-if="mediaOf(m) === 'image'"><a :href="m.attach" target="_blank" rel="noopener"><img class="wx-img" :src="m.attach" alt="Image" loading="lazy" /></a></template>
												<video v-else-if="mediaOf(m) === 'video'" class="wx-img" :src="m.attach" controls preload="metadata"></video>
												<audio v-else-if="mediaOf(m) === 'audio'" :src="m.attach" controls preload="metadata"></audio>
												<a v-else-if="mediaOf(m) === 'document'" class="wx-doc" :href="m.attach" target="_blank" rel="noopener"><Ico name="file" /><span class="ellipsis">{{ fileName(m.attach) }}</span><Ico name="download" size="sm" /></a>
												<div v-if="m.template_name && m.header" class="wx-text"><b>{{ m.header }}</b></div>
												<div v-if="bubbleText(m)" class="wx-text">{{ bubbleText(m) }}</div>
												<div v-if="m.template_name && m.footer" class="wx-foot-t">{{ m.footer }}</div>
												<div class="wx-meta">{{ clock(m.creation) }}<template v-if="m.type !== 'Incoming'"><svg v-if="tick(m) === 'failed'" class="wx-tick failed" viewBox="0 0 16 16" width="14" height="14" aria-label="Failed"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M8 4.5v4.2M8 10.8v.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg><svg v-else class="wx-tick" :class="tick(m)" viewBox="0 0 17 11" width="17" height="11" :aria-label="tick(m)"><path d="M1 5.8 4.2 9 10.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /><path v-if="tick(m) !== 'sent'" d="M6 8.6 6.6 9 13 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg></template></div>
												<span v-if="m.reaction" class="wx-reaction">{{ m.reaction }}</span></div></div></template></div>
									<div v-if="!hasNumber" class="wx-lock">{{ noNumberText || 'Add a phone number to message this person.' }}</div>
									<div v-else-if="!windowOpen" class="wx-lock"><div><b>Send a template first.</b> They have not written in the last 24 hours, so WhatsApp only allows an approved template. Once they reply, you can chat freely here.</div><Btn v-if="canWrite" variant="primary" icon="send" @click="$emit('template')">Send a template</Btn></div>
									<form v-else-if="canWrite" class="wx-compose" @submit.prevent="sendWa()">
										<div v-if="wa.reply" class="wx-replybar"><div class="wx-quote grow"><b>{{ wa.reply.type === 'Incoming' ? (wa.reply.from_name || person) : 'You' }}</b><span>{{ bubbleText(wa.reply) || 'Attachment' }}</span></div><button type="button" class="wx-ib" aria-label="Cancel reply" @click="wa.reply = null"><Ico name="x" size="sm" /></button></div>
										<div v-if="wa.pending" class="wx-replybar"><Ico :name="wa.pending.type === 'image' ? 'image' : 'file'" /><span class="grow ellipsis">{{ wa.pending.name }} <span class="small muted">goes with this message</span></span><button type="button" class="wx-ib" aria-label="Remove attachment" @click="wa.pending = null"><Ico name="x" size="sm" /></button></div>
										<div v-if="wa.emoji" class="wx-emoji"><div class="wx-etabs"><button v-for="t in EMOJI_TABS" :key="t" type="button" :class="{ on: wa.cat === t }" :aria-label="'Emoji group ' + t" @click="wa.cat = t">{{ t }}</button></div><div class="wx-egrid"><button v-for="x in EMOJI[wa.cat]" :key="x" type="button" :aria-label="'Emoji ' + x" @click="addEmoji(x)">{{ x }}</button></div></div>
										<div v-if="wa.menu" class="wx-attach"><button type="button" @click="pics.click()"><Ico name="image" /> Image</button><button type="button" @click="vids.click()"><Ico name="play" /> Video</button><button type="button" @click="docs.click()"><Ico name="file" /> Document</button></div>
										<div v-if="slash.length || (wa.text === '/' && !wa.replies.length)" class="wx-slash" role="listbox" aria-label="Saved replies"><button v-for="(r, i) in slash" :key="r.title" type="button" role="option" :class="{ on: i === wa.hi }" :aria-selected="String(i === wa.hi)" @mousedown.prevent="useReply(r)" @mouseenter="wa.hi = i"><b>{{ r.title }}</b><span class="ellipsis">{{ r.text }}</span></button><p v-if="!slash.length" class="small muted" style="margin:6px 10px">No saved replies yet. Add them under Campaigns, WhatsApp templates, Saved replies.</p></div>
										<button type="button" class="wx-ib" aria-label="Emoji" title="Emoji" @click="wa.emoji = !wa.emoji; wa.menu = false">😊</button>
										<button type="button" class="wx-ib" aria-label="Attach an image, video or document" title="Attach" :disabled="wa.busy" @click="wa.menu = !wa.menu; wa.emoji = false"><Ico name="paperclip" /></button>
										<button type="button" class="wx-ib" aria-label="Saved replies" title="Saved replies (or type /)" @click="wa.text = '/'; wa.emoji = false; wa.menu = false"><Ico name="zap" /></button>
										<input ref="pics" type="file" hidden accept="image/*" @change="pickFile" /><input ref="vids" type="file" hidden accept="video/*" @change="pickFile" /><input ref="docs" type="file" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,audio/*" @change="pickFile" />
										<input class="wx-in" v-model="wa.text" placeholder="Type a message, or / for saved replies" aria-label="WhatsApp message" @keydown="onKeys" @focus="wa.emoji = false" />
										<button type="submit" class="wx-send" aria-label="Send" :disabled="wa.busy || (!wa.text.trim() && !wa.pending) || (wa.text.startsWith('/') && slash.length > 0)"><Ico name="send" /></button>
									</form>
								</div>`,
	}
})()
