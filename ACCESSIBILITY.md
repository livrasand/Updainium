# Accessibility

Updainium should be usable by as many people as possible, regardless of their abilities, experience, or preferred way of interacting with a computer.

Accessibility is part of building reliable, maintainable software. This document describes our accessibility priorities, expectations for contributions, how to report barriers, and how we approach improvements.

## Priorities

We aim to make Updainium understandable, predictable, and usable without unnecessary barriers.

Our priorities include:

- **Keyboard access:** Make core features available without requiring a mouse, with a visible indication of keyboard focus.
- **Screen readers:** Provide meaningful labels, roles, states, and descriptions for interactive elements so assistive technologies can communicate their purpose.
- **Readable content:** Use clear language, sufficient text contrast, legible typography, and layouts that remain usable at different window sizes and text scaling levels.
- **Predictable interaction:** Use consistent controls, clear feedback, understandable error messages, and confirmation for actions that could result in data loss.
- **Language support:** Keep interface text suitable for translation and avoid assumptions that make the application difficult to understand across languages.
- **Error recovery:** Help users understand what went wrong and what they can do next, without relying on color alone to communicate important information.

We aim to work toward WCAG 2.2 Level AA principles where applicable to the application's interface. This is an aspirational goal, not a claim of verified conformance.

## Contributor expectations

Accessibility should be considered whenever a contribution changes the user interface or interaction behavior.

Contributors are expected to:

- Prefer semantic HTML and native controls when appropriate.
- Ensure interactive features can be operated with a keyboard.
- Preserve visible focus indicators and avoid keyboard traps.
- Provide accessible names for buttons, inputs, links, and other interactive elements.
- Associate form controls with clear labels and communicate validation errors.
- Avoid relying exclusively on color, position, sound, or animation to communicate information.
- Keep text understandable and interface behavior consistent.
- Consider translated text, longer labels, and different window sizes when changing layouts.
- Document relevant accessibility limitations when introducing behavior that may create a barrier.

For user-facing changes, include relevant testing details in the pull request. Where applicable, describe keyboard behavior, screen-reader considerations, and the environments tested.

Do not claim that a change is accessible solely because it renders correctly or passes automated checks. Automated tools can help identify problems, but they cannot detect every barrier.

## Reporting accessibility issues

If you encounter an accessibility barrier while using Updainium, please report it through the project's [GitHub Issues](https://github.com/livrasand/Updainium/issues).

Describe the problem in plain language. Helpful information includes:

- The task you were trying to complete.
- The affected screen, control, or application area.
- What you expected to happen and what happened instead.
- Your operating system and version.
- Your Updainium version.
- The input method or assistive technology involved, if applicable.
- Steps to reproduce the problem, if known.

Screenshots and recordings are optional. You do not need to disclose a disability or personal medical information to report an issue.

If the issue involves a security vulnerability rather than an accessibility barrier, please use an appropriate private reporting channel instead of a public issue.

### Severity

Maintainers may assign or adjust severity during triage. Reporters do not need to determine a severity level before submitting an issue.

We consider the following factors:

- **Critical:** An accessibility barrier prevents access to a core function, with no reasonable workaround.
- **High:** A major feature is difficult or impossible to use with a particular input method or assistive technology.
- **Medium:** A barrier makes a task unnecessarily difficult, confusing, or error-prone, but a workaround exists.
- **Low:** A minor usability or accessibility improvement would make the application more comfortable or consistent to use.

These descriptions guide prioritization and do not represent guaranteed resolution times.

### How we respond

Maintainers will review accessibility reports as project capacity permits.

When investigating an issue, we aim to:

- Understand the affected task and the users experiencing the barrier.
- Ask for clarification when necessary, without requiring personal medical information.
- Identify possible workarounds where practical.
- Keep the issue updated when meaningful progress or a relevant decision is available.
- Verify fixes against the reported behavior and, where practical, invite the reporter to confirm the result.

Response and resolution times are not guaranteed. The complexity of the issue, its impact, and available maintenance capacity may affect how quickly it can be addressed.

## Ownership and maintenance

Accessibility is a shared responsibility between contributors and maintainers.

Project maintainers are responsible for considering accessibility during review, evaluating reported barriers, and incorporating improvements into the development process where practical.

This document should be reviewed when the application's interaction model, supported platforms, or accessibility practices change significantly. If maintainership responsibilities change, accessibility ownership should transfer with the project's other maintenance responsibilities.

## Supported environments

Updainium is a desktop application built with Tauri and Svelte.

The operating systems, assistive technologies, input methods, and version combinations that have been systematically evaluated for accessibility are not yet documented here.

Support and behavior may differ depending on the operating system, the underlying webview, and the assistive technology in use. We do not claim that every combination has been tested.

Contributors and users are encouraged to report environment-specific barriers so that support can be investigated and documented.

## Known limitations

A comprehensive accessibility evaluation has not been documented in this statement. We therefore cannot claim that Updainium is free of accessibility barriers or that it conforms to a particular accessibility standard.

Potential areas for further evaluation include:

- Keyboard navigation and focus management across all application screens.
- Screen-reader announcements for controls, status changes, progress, and errors.
- Text contrast, scaling, and layout behavior.
- Error handling and recovery during downloads and other long-running operations.
- Usability across supported operating systems and their respective accessibility features.

These are areas to evaluate, not assertions that every listed problem is currently present. Confirmed limitations should be documented with their corresponding issue and any available workaround.

## Feedback and improvements

We welcome suggestions that make Updainium more accessible, understandable, and easier to use.

To report an active barrier, please follow the [Reporting accessibility issues](#reporting-accessibility-issues) process.

To suggest improvements to this statement or our accessibility practices, open an issue in the [Updainium repository](https://github.com/livrasand/Updainium/issues).

Accessibility is an ongoing effort. Clear reports, thoughtful contributions, and practical testing help us identify barriers and improve the experience for everyone.
