/**
 * PostCSS configuration for the project.
 *
 * Tailwind CSS is used as a PostCSS plugin to generate utility classes
 * on demand.  In addition to Tailwind, Autoprefixer is included to
 * automatically add vendor prefixes based on the project’s browser
 * support matrix.  Without Autoprefixer modern CSS features may not
 * work consistently across all browsers.  See the Tailwind CSS docs
 * for more details: https://tailwindcss.com/docs/installation
 *
 * This file uses the ESM syntax supported by recent versions of
 * Node.js.  If you need to use CommonJS instead, rename the file to
 * `postcss.config.js` and replace the `export default` with
 * `module.exports =`.
 *
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    /**
     * Tailwind CSS plugin.  Loads your Tailwind configuration from
     * `tailwind.config.ts` and processes your CSS to generate the
     * appropriate utility classes.  See
     * https://tailwindcss.com/docs/using-with-preprocessors#post-css for
     * details.
     */
    '@tailwindcss/postcss': {},

    /**
     * Autoprefixer plugin.  Automatically adds vendor prefixes to
     * properties based on the Browserslist configuration specified in
     * your package.json.  This helps ensure consistent behavior across
     * different browsers and is recommended when using Tailwind.
     */
    autoprefixer: {},
  },
};

export default config;
