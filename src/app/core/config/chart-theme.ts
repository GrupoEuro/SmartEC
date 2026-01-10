export const CHART_THEME = {
    colors: {
        primary: '#fbbf24',   // Amber 400
        secondary: '#60a5fa', // Blue 400
        success: '#34d399',   // Emerald 400
        danger: '#fb7185',    // Rose 400
        info: '#22d3ee',      // Cyan 400
        warning: '#ffb020',   // Orange/Amber mix (Custom)
        purple: '#a78bfa',    // Violet 400

        // Backgrounds (Transparent)
        bg: {
            primary: 'rgba(251, 191, 36, 0.1)',
            secondary: 'rgba(96, 165, 250, 0.1)',
            success: 'rgba(52, 211, 153, 0.1)',
            danger: 'rgba(251, 113, 133, 0.1)',
            warning: 'rgba(255, 176, 32, 0.1)',
            tooltip: 'rgba(15, 23, 42, 0.95)'
        },

        // Text & Grids
        text: {
            primary: '#e2e8f0', // Slate 200
            secondary: '#94a3b8' // Slate 400
        },
        grid: 'rgba(148, 163, 184, 0.1)'
    },

    // Categorical Palette for Pie/Doughnut charts
    palette: [
        '#fbbf24', // Amber
        '#60a5fa', // Blue
        '#34d399', // Emerald
        '#fb7185', // Rose
        '#a78bfa', // Violet
        '#22d3ee', // Cyan
        '#f472b6', // Pink
        '#818cf8'  // Indigo
    ],

    fonts: {
        family: 'Inter, system-ui, sans-serif'
    }
};
