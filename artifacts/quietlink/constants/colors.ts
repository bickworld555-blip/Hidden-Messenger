/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#12211F',
    tint: '#087E70',
    background: '#F4F7F6',
    foreground: '#12211F',
    card: '#FFFFFF',
    cardForeground: '#12211F',
    primary: '#087E70',
    primaryForeground: '#FFFFFF',
    secondary: '#E8F0ED',
    secondaryForeground: '#23433D',
    muted: '#EDF2F0',
    mutedForeground: '#71817D',
    accent: '#D8EEE8',
    accentForeground: '#07594F',
    destructive: '#C94D51',
    destructiveForeground: '#FFFFFF',
    border: '#E2EAE7',
    input: '#E2EAE7',
  },
  dark: {
    text: '#E9F3EF',
    tint: '#54C8B0',
    background: '#101A18',
    foreground: '#E9F3EF',
    card: '#182522',
    cardForeground: '#E9F3EF',
    primary: '#54C8B0',
    primaryForeground: '#0C211C',
    secondary: '#23332F',
    secondaryForeground: '#D1E6DE',
    muted: '#23332F',
    mutedForeground: '#9EB1AA',
    accent: '#284941',
    accentForeground: '#B8EADD',
    destructive: '#E07175',
    destructiveForeground: '#201112',
    border: '#2A3B36',
    input: '#2A3B36',
  },
  radius: 16,
};

export default colors;
