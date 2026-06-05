Pod::Spec.new do |s|
  s.name           = 'VocaNative'
  s.version        = '1.0.0'
  s.summary        = 'Local native module for Voca Dictionary App Group and Shared Storage'
  s.description    = 'Local native module for Voca Dictionary App Group and Shared Storage'
  s.author         = 'Voca'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '13.4' }
  s.source         = { :git => '' }
  s.source_files   = '**/*.{h,m,swift}'
  s.dependency 'ExpoModulesCore'
end
