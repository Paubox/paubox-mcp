// Paubox Brand Colors
// Based on @paubox/components theme colors

export const pauboxColors = {
  // Primary Colors (Blue)
  primary: {
    100: '#E8EFFF',
    200: '#D4E2FF',
    300: '#94B6FF',
    400: '#6193FF',
    500: '#2E70FF',
    600: '#0247DC',
    700: '#003AB8',
    800: '#003099',
    900: '#002066',
  },
  
  // Secondary Colors (Yellow/Warning)
  secondary: {
    100: '#FFF8E4',
    200: '#FFF1C7',
    300: '#FFE394',
    400: '#FFD761',
    500: '#FFCA2F',
    600: '#FBBB00',
    700: '#CC9800',
    800: '#997200',
    900: '#664C00',
  },
  
  // Success Colors (Green)
  success: {
    100: '#ECFDF8',
    200: '#D1FAEC',
    300: '#A5F3D9',
    400: '#6EE7BF',
    500: '#36D39F',
    600: '#0EA472',
    700: '#08875D',
    800: '#04724D',
    900: '#066042',
  },
  
  // Danger Colors (Red)
  danger: {
    100: '#FEF1F2',
    200: '#FEE1E3',
    300: '#FEC8CC',
    400: '#FCA6AD',
    500: '#F8727D',
    600: '#EF4352',
    700: '#E02D3C',
    800: '#BA2532',
    900: '#981B25',
  },
  
  // Neutral Colors (Gray)
  neutral: {
    100: '#F2F2F2',
    200: '#E3E3E3',
    300: '#C9C9C9',
    400: '#B3B3B3',
    500: '#757575',
    600: '#4D4D4D',
    700: '#333333',
    800: '#1A1A1A',
    900: '#000000',
  },
  
  // Text Colors
  text: {
    primary: '#1D2433',
    secondary: '#1D2433CC',
    primaryWhite: '#FFFFFF',
    primaryDisabled: '#545D78',
    primaryIconDisabled: '#0000004D',
    danger: '#E02D3C',
    dangerHover: '#E34553',
    dangerPressed: '#E02D3C',
  },
} as const;

// Utility function to get color with opacity
export const withOpacity = (color: string, opacity: number) => {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

// Common color combinations for components
export const pauboxTheme = {
  // Card styles
  card: {
    header: {
      background: `linear-gradient(to right, ${pauboxColors.primary[100]}, ${pauboxColors.primary[200]})`,
      border: `${pauboxColors.primary[500]}20`,
      text: pauboxColors.primary[600],
    },
    content: {
      background: '#FFFFFF',
      border: pauboxColors.neutral[200],
    },
    footer: {
      background: '#F8F9FA',
      border: pauboxColors.neutral[200],
      text: pauboxColors.neutral[500],
    },
  },
  
  // Button styles
  button: {
    primary: {
      background: pauboxColors.primary[600],
      text: pauboxColors.text.primaryWhite,
      hover: pauboxColors.primary[700],
      border: pauboxColors.primary[600],
    },
    outline: {
      background: 'transparent',
      text: pauboxColors.primary[600],
      hover: pauboxColors.primary[600],
      border: pauboxColors.primary[600],
    },
  },
  
  // Alert styles
  alert: {
    warning: {
      background: pauboxColors.secondary[100],
      border: pauboxColors.secondary[500],
      text: pauboxColors.secondary[900],
      code: pauboxColors.secondary[200],
    },
    success: {
      background: pauboxColors.success[100],
      border: pauboxColors.success[500],
      text: pauboxColors.success[900],
    },
    danger: {
      background: pauboxColors.danger[100],
      border: pauboxColors.danger[500],
      text: pauboxColors.danger[900],
    },
  },
} as const; 