/**
 * Privacy disguise provider/service registry.
 * Tab title and favicon are derived from the selected service (not user-customizable).
 */

import googleG from '$lib/assets/Google__G__logo.svg';
import googleDocsIcon from '$lib/assets/Google_Docs_logo_(2014-2020).svg';
import googleSheetsIcon from '$lib/assets/privacy/google-sheets.svg';
import googleSlidesIcon from '$lib/assets/privacy/google-slides.svg';
import googleDriveIcon from '$lib/assets/privacy/google-drive.svg';
import googleGmailIcon from '$lib/assets/privacy/google-gmail.svg';
import googleCalendarIcon from '$lib/assets/privacy/google-calendar.svg';
import googleMeetIcon from '$lib/assets/privacy/google-meet.svg';
import microsoftLogo from '$lib/assets/privacy/microsoft-logo.svg';
import msWordIcon from '$lib/assets/privacy/microsoft-word.svg';
import msExcelIcon from '$lib/assets/privacy/microsoft-excel.svg';
import msPowerPointIcon from '$lib/assets/privacy/microsoft-powerpoint.svg';
import msOutlookIcon from '$lib/assets/privacy/microsoft-outlook.svg';
import msOneDriveIcon from '$lib/assets/privacy/microsoft-onedrive.svg';
import msOneNoteIcon from '$lib/assets/privacy/microsoft-onenote.svg';
import msTeamsIcon from '$lib/assets/privacy/microsoft-teams.svg';

import googleDocsIconUrl from '$lib/assets/Google_Docs_logo_(2014-2020).svg?url';
import googleSheetsIconUrl from '$lib/assets/privacy/google-sheets.svg?url';
import googleSlidesIconUrl from '$lib/assets/privacy/google-slides.svg?url';
import googleDriveIconUrl from '$lib/assets/privacy/google-drive.svg?url';
import googleGmailIconUrl from '$lib/assets/privacy/google-gmail.svg?url';
import googleCalendarIconUrl from '$lib/assets/privacy/google-calendar.svg?url';
import googleMeetIconUrl from '$lib/assets/privacy/google-meet.svg?url';
import msWordIconUrl from '$lib/assets/privacy/microsoft-word.svg?url';
import msExcelIconUrl from '$lib/assets/privacy/microsoft-excel.svg?url';
import msPowerPointIconUrl from '$lib/assets/privacy/microsoft-powerpoint.svg?url';
import msOutlookIconUrl from '$lib/assets/privacy/microsoft-outlook.svg?url';
import msOneDriveIconUrl from '$lib/assets/privacy/microsoft-onedrive.svg?url';
import msOneNoteIconUrl from '$lib/assets/privacy/microsoft-onenote.svg?url';
import msTeamsIconUrl from '$lib/assets/privacy/microsoft-teams.svg?url';

export type PrivacyDisguiseProvider = 'google' | 'microsoft';

export interface DisguiseProviderTheme {
	primary: string;
	primaryHover: string;
	primaryDisabled: string;
	onSurface: string;
	onSurfaceVariant: string;
	outline: string;
	filledSurface: string;
	pageBackground: string;
	cardBackground: string;
	fontFamily: string;
	fontStylesheet: string | null;
	providerLogo: string;
	providerLogoSize: { w: number; h: number };
	signInHeading: string;
	continueTo: (serviceLabel: string) => string;
	privacyCopy: (serviceLabel: string) => string;
	submitLabel: string;
	rememberMeLabel: string;
	buttonShape: 'pill';
	cardMaxWidth: string;
	cardShadow: string;
	cardBorder: string;
}

export interface DisguiseServiceConfig {
	id: string;
	provider: PrivacyDisguiseProvider;
	label: string;
	tabTitles: readonly string[];
	serviceIcon: string;
	faviconUrl: string;
	rememberRedirect: string;
}

export const PRIVACY_DISGUISE_PROVIDERS: {
	id: PrivacyDisguiseProvider;
	label: string;
	defaultServiceId: string;
}[] = [
	{ id: 'google', label: 'Google', defaultServiceId: 'docs' },
	{ id: 'microsoft', label: 'Microsoft', defaultServiceId: 'word' }
];

export const GOOGLE_PROVIDER_THEME: DisguiseProviderTheme = {
	primary: '#1976d2',
	primaryHover: '#1565c0',
	primaryDisabled: 'rgba(0, 0, 0, 0.12)',
	onSurface: 'rgba(0, 0, 0, 0.87)',
	onSurfaceVariant: 'rgba(0, 0, 0, 0.6)',
	outline: 'rgba(0, 0, 0, 0.23)',
	filledSurface: 'rgba(0, 0, 0, 0.06)',
	pageBackground: '#fafafa',
	cardBackground: '#ffffff',
	fontFamily: 'Roboto, Helvetica, Arial, sans-serif',
	fontStylesheet:
		'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
	providerLogo: googleG,
	providerLogoSize: { w: 48, h: 48 },
	signInHeading: 'Sign in',
	continueTo: (s) => `to continue to ${s}`,
	privacyCopy: (s) => `Privacy mode is enabled for ${s}, enter the passcode to unlock it.`,
	submitLabel: 'Next',
	rememberMeLabel: 'Remember me',
	buttonShape: 'pill',
	cardMaxWidth: '450px',
	cardShadow:
		'0px 2px 1px -1px rgba(0,0,0,0.2), 0px 1px 1px 0px rgba(0,0,0,0.14), 0px 1px 3px 0px rgba(0,0,0,0.12)',
	cardBorder: '1px solid rgba(0, 0, 0, 0.08)'
};

export const MICROSOFT_PROVIDER_THEME: DisguiseProviderTheme = {
	primary: '#0078d4',
	primaryHover: '#106ebe',
	primaryDisabled: '#c8c6c4',
	onSurface: '#242424',
	onSurfaceVariant: '#616161',
	outline: '#8a8886',
	filledSurface: '#ffffff',
	pageBackground: '#f3f2f1',
	cardBackground: '#ffffff',
	fontFamily:
		'"Segoe UI", "Segoe UI Web (West European)", -apple-system, BlinkMacSystemFont, Roboto, Helvetica, sans-serif',
	fontStylesheet: null,
	providerLogo: microsoftLogo,
	providerLogoSize: { w: 24, h: 24 },
	signInHeading: 'Sign in',
	continueTo: (s) => `to continue to ${s}`,
	privacyCopy: (s) => `Privacy mode is enabled for ${s}. Enter the passcode to unlock it.`,
	submitLabel: 'Sign in',
	rememberMeLabel: 'Keep me signed in',
	buttonShape: 'pill',
	cardMaxWidth: '440px',
	cardShadow: '0 1.6px 3.6px 0 rgba(0,0,0,0.132), 0 0.3px 0.9px 0 rgba(0,0,0,0.108)',
	cardBorder: '1px solid transparent'
};

export const DISGUISE_SERVICES: DisguiseServiceConfig[] = [
	{
		id: 'docs',
		provider: 'google',
		label: 'Google Docs',
		tabTitles: ['Google Docs', 'Untitled document - Google Docs'],
		serviceIcon: googleDocsIcon,
		faviconUrl: googleDocsIconUrl,
		rememberRedirect: 'https://docs.google.com/document/u/0/'
	},
	{
		id: 'sheets',
		provider: 'google',
		label: 'Google Sheets',
		tabTitles: ['Google Sheets', 'Untitled spreadsheet - Google Sheets'],
		serviceIcon: googleSheetsIcon,
		faviconUrl: googleSheetsIconUrl,
		rememberRedirect: 'https://docs.google.com/spreadsheets/u/0/'
	},
	{
		id: 'slides',
		provider: 'google',
		label: 'Google Slides',
		tabTitles: ['Google Slides', 'Untitled presentation - Google Slides'],
		serviceIcon: googleSlidesIcon,
		faviconUrl: googleSlidesIconUrl,
		rememberRedirect: 'https://docs.google.com/presentation/u/0/'
	},
	{
		id: 'drive',
		provider: 'google',
		label: 'Google Drive',
		tabTitles: ['My Drive - Google Drive', 'Google Drive'],
		serviceIcon: googleDriveIcon,
		faviconUrl: googleDriveIconUrl,
		rememberRedirect: 'https://drive.google.com/drive/my-drive'
	},
	{
		id: 'gmail',
		provider: 'google',
		label: 'Gmail',
		tabTitles: ['Gmail', 'Inbox - Gmail'],
		serviceIcon: googleGmailIcon,
		faviconUrl: googleGmailIconUrl,
		rememberRedirect: 'https://mail.google.com/mail/u/0/'
	},
	{
		id: 'calendar',
		provider: 'google',
		label: 'Google Calendar',
		tabTitles: ['Google Calendar', 'Calendar - Google Calendar'],
		serviceIcon: googleCalendarIcon,
		faviconUrl: googleCalendarIconUrl,
		rememberRedirect: 'https://calendar.google.com/calendar/u/0/r'
	},
	{
		id: 'meet',
		provider: 'google',
		label: 'Google Meet',
		tabTitles: ['Google Meet', 'Meet - Google Meet'],
		serviceIcon: googleMeetIcon,
		faviconUrl: googleMeetIconUrl,
		rememberRedirect: 'https://meet.google.com/'
	},
	{
		id: 'word',
		provider: 'microsoft',
		label: 'Word',
		tabTitles: ['Document1 - Word', 'Word'],
		serviceIcon: msWordIcon,
		faviconUrl: msWordIconUrl,
		rememberRedirect: 'https://www.office.com/launch/word'
	},
	{
		id: 'excel',
		provider: 'microsoft',
		label: 'Excel',
		tabTitles: ['Book1 - Excel', 'Excel'],
		serviceIcon: msExcelIcon,
		faviconUrl: msExcelIconUrl,
		rememberRedirect: 'https://www.office.com/launch/excel'
	},
	{
		id: 'powerpoint',
		provider: 'microsoft',
		label: 'PowerPoint',
		tabTitles: ['Presentation1 - PowerPoint', 'PowerPoint'],
		serviceIcon: msPowerPointIcon,
		faviconUrl: msPowerPointIconUrl,
		rememberRedirect: 'https://www.office.com/launch/powerpoint'
	},
	{
		id: 'outlook',
		provider: 'microsoft',
		label: 'Outlook',
		tabTitles: ['Mail - Outlook', 'Outlook'],
		serviceIcon: msOutlookIcon,
		faviconUrl: msOutlookIconUrl,
		rememberRedirect: 'https://outlook.office.com/mail/'
	},
	{
		id: 'onedrive',
		provider: 'microsoft',
		label: 'OneDrive',
		tabTitles: ['My files - OneDrive', 'OneDrive'],
		serviceIcon: msOneDriveIcon,
		faviconUrl: msOneDriveIconUrl,
		rememberRedirect: 'https://onedrive.live.com/'
	},
	{
		id: 'onenote',
		provider: 'microsoft',
		label: 'OneNote',
		tabTitles: ['Notebook - OneNote', 'OneNote'],
		serviceIcon: msOneNoteIcon,
		faviconUrl: msOneNoteIconUrl,
		rememberRedirect: 'https://www.onenote.com/notebooks'
	},
	{
		id: 'teams',
		provider: 'microsoft',
		label: 'Microsoft Teams',
		tabTitles: ['Microsoft Teams', 'Chat | Microsoft Teams'],
		serviceIcon: msTeamsIcon,
		faviconUrl: msTeamsIconUrl,
		rememberRedirect: 'https://teams.microsoft.com/'
	}
];

const SERVICE_BY_KEY = new Map<string, DisguiseServiceConfig>(
	DISGUISE_SERVICES.map((s) => [`${s.provider}:${s.id}`, s])
);

export function getProviderTheme(provider: PrivacyDisguiseProvider): DisguiseProviderTheme {
	return provider === 'microsoft' ? MICROSOFT_PROVIDER_THEME : GOOGLE_PROVIDER_THEME;
}

export function getServicesForProvider(provider: PrivacyDisguiseProvider): DisguiseServiceConfig[] {
	return DISGUISE_SERVICES.filter((s) => s.provider === provider);
}

export function resolveDisguiseService(
	provider: string | null | undefined,
	serviceId: string | null | undefined
): DisguiseServiceConfig {
	const p: PrivacyDisguiseProvider = provider === 'microsoft' ? 'microsoft' : 'google';
	const services = getServicesForProvider(p);
	const match = services.find((s) => s.id === serviceId);
	if (match) return match;
	return services[0]!;
}

export function getDefaultServiceId(provider: PrivacyDisguiseProvider): string {
	return PRIVACY_DISGUISE_PROVIDERS.find((p) => p.id === provider)?.defaultServiceId ?? 'docs';
}

export function isValidDisguiseService(provider: PrivacyDisguiseProvider, serviceId: string): boolean {
	return SERVICE_BY_KEY.has(`${provider}:${serviceId}`);
}

export function isDecoyTitleForService(service: DisguiseServiceConfig, title: string): boolean {
	return (service.tabTitles as readonly string[]).includes(title);
}

export function pickDecoyTitleForService(service: DisguiseServiceConfig): string {
	const titles = service.tabTitles;
	return titles[Math.floor(Math.random() * titles.length)]!;
}

export function getDecoyFaviconUrl(
	provider: PrivacyDisguiseProvider,
	serviceId: string
): string {
	return resolveDisguiseService(provider, serviceId).faviconUrl;
}
