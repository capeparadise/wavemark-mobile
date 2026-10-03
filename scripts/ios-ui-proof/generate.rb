require 'xcodeproj'
require 'fileutils'

# Separate UI-test runner: never edits RPPL's native project or installs over it.
destination = ARGV.fetch(0)
FileUtils.mkdir_p(destination)
project = Xcodeproj::Project.new(File.join(destination, 'RPPLProof.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'RPPLProof', :ios, '17.0')
target.add_file_references([project.main_group.new_file(File.expand_path('RPPLProof.swift', __dir__))])
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.capeparadise.rppl.localproof',
    'SWIFT_VERSION' => '5.0',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'TARGETED_DEVICE_FAMILY' => '1',
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project.path, 'RPPLProof', true)
puts project.path
